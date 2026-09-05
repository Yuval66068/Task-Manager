import { withSupabase } from 'npm:@supabase/server@^1'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

    let body: { email?: unknown }
    try {
      body = (await req.json()) as { email?: unknown }
    } catch {
      return jsonResponse({ error: 'Invalid JSON payload.' }, 400)
    }

    const callerId = ctx.userClaims?.id ?? ctx.jwtClaims?.sub
    if (!callerId) {
      return jsonResponse({ error: 'Authentication required.' }, 401)
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email || !EMAIL_PATTERN.test(email)) {
      return jsonResponse({ error: 'יש להזין כתובת אימייל תקינה' }, 400)
    }

    const { data: parentMemberships, error: membershipError } = await ctx.supabase
      .from('family_members')
      .select('family_id')
      .eq('user_id', callerId)
      .eq('role', 'parent')
      .limit(1)

    if (membershipError || !parentMemberships || parentMemberships.length === 0) {
      console.error('family-invite: unable to resolve parent membership.', membershipError?.message ?? 'none')
      return jsonResponse({ error: 'Not authorized to invite a parent.' }, 403)
    }

    const familyId = parentMemberships[0]?.family_id
    if (!familyId) {
      return jsonResponse({ error: 'Not authorized to invite a parent.' }, 403)
    }

    const { data, error } = await ctx.supabaseAdmin.rpc('create_family_invite', {
      p_family_id: familyId,
      p_inviter_id: callerId,
      p_invitee_email: email,
    })

    if (error) {
      console.error('family-invite: create_family_invite failed.', error.message)
      return jsonResponse({ error: 'לא ניתן היה לשלוח את ההזמנה' }, 400)
    }

    return jsonResponse({ success: true, invite: data })
  }),
}
