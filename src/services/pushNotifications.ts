import { getSupabaseClient } from './supabase'

export type PushSupportStatus = 'unsupported' | 'supported'

/**
 * Converts a base64url-encoded VAPID public key into the Uint8Array format
 * required by PushManager.subscribe's applicationServerKey option.
 */
function base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length))

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i)
  }

  return outputArray
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function getVapidPublicKey(): string | null {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim()
  return key ? key : null
}

async function registerSubscriptionWithBackend(subscription: PushSubscription): Promise<void> {
  const subscriptionJson = subscription.toJSON()
  const endpoint = subscriptionJson.endpoint
  const p256dh = subscriptionJson.keys?.p256dh
  const auth = subscriptionJson.keys?.auth

  if (!endpoint || !p256dh || !auth) {
    console.error('Push subscription is missing required fields.', subscriptionJson)
    throw new Error('incomplete-subscription')
  }

  const supabase = getSupabaseClient()
  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
  })

  if (error) {
    console.error('Failed to register push subscription with the backend.', error)
    throw new Error('registration-failed')
  }
}

/**
 * Requests notification permission (must be called from a user gesture),
 * then creates or reuses a PushSubscription for this device and registers
 * it with the backend via the register_push_subscription RPC. Ownership of
 * the subscription is always derived server-side from auth.uid() — no
 * user_id is ever sent from the client.
 */
export async function enablePushNotifications(): Promise<void> {
  if (!isPushSupported()) {
    throw new Error('unsupported')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('permission-denied')
  }

  const vapidPublicKey = getVapidPublicKey()
  if (!vapidPublicKey) {
    console.error(
      'Push notifications are unavailable: VITE_VAPID_PUBLIC_KEY is not set. Add it to your .env file.',
    )
    throw new Error('missing-vapid-key')
  }

  const registration = await navigator.serviceWorker.ready

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
    })
  }

  await registerSubscriptionWithBackend(subscription)
}

/**
 * Silently re-associates an ALREADY EXISTING browser PushSubscription with
 * the currently authenticated user. Never prompts for notification
 * permission and never creates a new subscription — this only runs when
 * permission is already granted and a subscription already exists on this
 * device (e.g. a shared device switching between family member accounts).
 *
 * The backend RPC derives ownership solely from auth.uid() and safely
 * reassigns the endpoint to the current user if it previously belonged to
 * someone else, so calling this on every authenticated session change is
 * safe and does not create duplicate subscriptions.
 *
 * Returns true only if an existing subscription was found and successfully
 * registered/re-associated for the current user.
 */
export async function reclaimExistingPushSubscription(): Promise<boolean> {
  if (!isPushSupported()) {
    return false
  }

  if (Notification.permission !== 'granted') {
    return false
  }

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
      return false
    }

    await registerSubscriptionWithBackend(subscription)
    return true
  } catch (error) {
    console.error('Failed to silently re-register existing push subscription for the current user.', error)
    return false
  }
}

/**
 * Returns whether this device already has an active PushSubscription and
 * notification permission has been granted (used to restore UI state on
 * load without prompting the user).
 */
export async function getExistingPushSubscriptionState(): Promise<{
  hasSubscription: boolean
  permission: NotificationPermission | 'unsupported'
}> {
  if (!isPushSupported()) {
    return { hasSubscription: false, permission: 'unsupported' }
  }

  if (Notification.permission !== 'granted') {
    return { hasSubscription: false, permission: Notification.permission }
  }

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return { hasSubscription: Boolean(subscription), permission: Notification.permission }
  } catch (error) {
    console.error('Failed to read existing push subscription state.', error)
    return { hasSubscription: false, permission: Notification.permission }
  }
}

