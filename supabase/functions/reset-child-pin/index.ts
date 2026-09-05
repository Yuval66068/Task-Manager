import { withSupabase } from 'npm:@supabase/server@^1'
import { deriveChildAuthPassword } from '../_shared/childPin.ts'

const PIN_PATTERN = /^\d{6}$/
const CHILD_PIN_PEPPER = Deno.env.get('CHILD_PIN_PEPPER')

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req: Request, ctx) => {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    if (!CHILD_PIN_PEPPER) {
      console.error('reset-child-pin: missing CHILD_PIN_PEPPER environment variable.')
      return jsonResponse({ error: 'Child PIN reset is not configured.' }, 500)
    }

    let body: { childUserId?: unknown; newPin?: unknown }
    try {
      body = (await req.json()) as { childUserId?: unknown; newPin?: unknown }
    } catch {
      return jsonResponse({ error: 'Invalid JSON payload.' }, 400)
    }

    const callerId = ctx.userClaims?.id ?? ctx.jwtClaims?.sub
    if (!callerId) {
      return jsonResponse({ error: 'Authentication required.' }, 401)
    }

    const targetChildId = typeof body.childUserId === 'string' ? body.childUserId.trim() : ''
    const newPin = typeof body.newPin === 'string' ? body.newPin : ''

    if (!targetChildId || !PIN_PATTERN.test(newPin)) {
      return jsonResponse({ error: 'Child and new PIN are required.' }, 400)
    }

    const { data: parentMemberships, error: parentMembershipError } = await ctx.supabase
      .from('family_members')
      .select('family_id')
      .eq('user_id', callerId)
      .eq('role', 'parent')

    if (parentMembershipError || !parentMemberships || parentMemberships.length === 0) {
      return jsonResponse({ error: 'Only parents can reset a child PIN.' }, 403)
    }

    const parentFamilyIds = parentMemberships.map((membership) => membership.family_id)
    const { data: targetMembership, error: targetMembershipError } = await ctx.supabase
      .from('family_members')
      .select('family_id, role')
      .eq('user_id', targetChildId)
      .eq('role', 'child')
      .maybeSingle()

    if (targetMembershipError || !targetMembership) {
      return jsonResponse({ error: 'Target child was not found.' }, 404)
    }

    if (!parentFamilyIds.includes(targetMembership.family_id)) {
      return jsonResponse({ error: 'Child must belong to the same family.' }, 403)
    }

    const { data: targetUserResult, error: targetUserError } = await ctx.supabaseAdmin.auth.admin.getUserById(targetChildId)
    if (targetUserError || !targetUserResult?.user) {
      return jsonResponse({ error: 'Target child account is not available.' }, 404)
    }

    const appMetadata = (targetUserResult.user.app_metadata ?? {}) as Record<string, unknown>
    const stableCredentialId = appMetadata.child_credential_id
    const isSyntheticChildAccount = appMetadata.is_synthetic_child_account

    if (isSyntheticChildAccount !== true || typeof stableCredentialId !== 'string' || stableCredentialId.length === 0) {
      return jsonResponse({ error: 'Target child account is not configured for PIN reset.' }, 400)
    }

    const nextDerivedPassword = await deriveChildAuthPassword(stableCredentialId, newPin, CHILD_PIN_PEPPER)
    const { error: updateError } = await ctx.supabaseAdmin.auth.admin.updateUserById(targetChildId, {
      password: nextDerivedPassword,
    })

    if (updateError) {
      console.error('reset-child-pin: failed to update password.', updateError.message)
      return jsonResponse({ error: 'Unable to update PIN.' }, 500)
    }

    return jsonResponse({ success: true })
  }),
}
