// supabase/functions/send-push-notification/index.ts
//
// PHASE PUSH-3A — Web Push sender Edge Function.
//
// This function is invoked with a Database Webhook-style payload for an
// INSERT into public.notifications. It looks up every registered device
// (public.push_subscriptions) belonging to the notification's recipient and
// sends the same Web Push payload to each device via the Web Push protocol.
//
// It does NOT create notification rows -- it only delivers an already
// existing one. It is not intended to be called directly by the frontend;
// it is meant to be wired to a Supabase Database Webhook in a later phase.
//
// Authentication is handled by @supabase/server's withSupabase({ auth:
// 'secret' }) wrapper: the caller must present a valid Supabase secret API
// key in the `apikey` header. The handler below only ever runs after that
// check has already succeeded -- an invalid or missing key never reaches
// this code, never queries push_subscriptions, and never sends a push.
//
// Secrets (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) and the
// Supabase secret API key are read exclusively from Edge Function
// environment variables and are never logged or returned in responses.

import { withSupabase } from 'npm:@supabase/server@^1'
import webpush from 'web-push'

type NotificationRecord = {
  id: string
  family_id?: string
  recipient_id: string
  actor_id?: string | null
  type?: string
  message: string
  task_id?: string | null
  reward_id?: string | null
  [key: string]: unknown
}

type WebhookPayload = {
  type?: string
  table?: string
  schema?: string
  record?: NotificationRecord
  old_record?: NotificationRecord | null
}

type PushSubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function isValidWebhookPayload(payload: unknown): payload is WebhookPayload & { record: NotificationRecord } {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }

  const candidate = payload as WebhookPayload

  if (candidate.type !== 'INSERT') {
    return false
  }

  if (candidate.table !== 'notifications') {
    return false
  }

  if (candidate.schema !== 'public') {
    return false
  }

  const record = candidate.record
  if (!record || typeof record !== 'object') {
    return false
  }

  if (!record.id || !record.recipient_id || !record.message) {
    return false
  }

  return true
}

export default {
  fetch: withSupabase({ auth: 'secret' }, async (req: Request, ctx) => {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      console.error('send-push-notification misconfigured: missing VAPID environment variables.')
      return jsonResponse({ error: 'Push sender is not configured.' }, 500)
    }

    let payload: unknown
    try {
      payload = await req.json()
    } catch (error) {
      console.error('send-push-notification: failed to parse request body as JSON.', error)
      return jsonResponse({ error: 'Invalid JSON payload.' }, 400)
    }

    if (!isValidWebhookPayload(payload)) {
      console.error('send-push-notification: rejected payload that did not match the expected webhook shape.')
      return jsonResponse({ error: 'Invalid webhook payload.' }, 400)
    }

    const notification = payload.record

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    // ctx.supabaseAdmin bypasses RLS (service role) and is only available
    // here because withSupabase's 'secret' auth check has already
    // succeeded for this request. Authorization for "whose devices do we
    // send to" comes exclusively from notification.recipient_id in the
    // webhook payload -- never from any client-supplied identity.
    const { data: subscriptions, error: subscriptionsError } = await ctx.supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', notification.recipient_id)

    if (subscriptionsError) {
      console.error('send-push-notification: failed to load push subscriptions.', subscriptionsError.message)
      return jsonResponse({ error: 'Failed to load push subscriptions.' }, 500)
    }

    const rows = (subscriptions ?? []) as PushSubscriptionRow[]

    if (rows.length === 0) {
      console.log(
        `send-push-notification: no registered devices for recipient (notification ${notification.id}).`,
      )
      return jsonResponse({ sent: 0, failed: 0, staleRemoved: 0 })
    }

    const pushPayload = JSON.stringify({
      title: 'Family Tasks',
      body: notification.message,
      url: '/',
      tag: notification.id,
      notificationId: notification.id,
      type: notification.type,
    })

    let sent = 0
    let failed = 0
    let staleRemoved = 0

    await Promise.all(
      rows.map(async (row) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: row.endpoint,
              keys: {
                p256dh: row.p256dh,
                auth: row.auth,
              },
            },
            pushPayload,
          )
          sent += 1
        } catch (error) {
          const statusCode = (error as { statusCode?: number })?.statusCode

          if (statusCode === 404 || statusCode === 410) {
            // Expired/unregistered subscription: remove only this exact row.
            // Never remove the user's other devices, and never remove a row
            // due to a transient failure (network error, 5xx, etc.).
            const { error: deleteError } = await ctx.supabaseAdmin
              .from('push_subscriptions')
              .delete()
              .eq('id', row.id)

            if (deleteError) {
              console.error('send-push-notification: failed to remove stale subscription.', deleteError.message)
            } else {
              staleRemoved += 1
            }
          } else {
            console.error(
              `send-push-notification: delivery failed for notification ${notification.id} (status ${statusCode ?? 'unknown'}).`,
            )
          }

          failed += 1
        }
      }),
    )

    console.log(
      `send-push-notification: notification=${notification.id} type=${notification.type ?? 'unknown'} recipient=${notification.recipient_id} sent=${sent} failed=${failed} staleRemoved=${staleRemoved}`,
    )

    return jsonResponse({ sent, failed, staleRemoved })
  }),
}
