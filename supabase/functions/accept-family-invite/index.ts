import { withSupabase } from 'npm:@supabase/server@^1'

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

    let body: { inviteToken?: unknown }
    try {
      body = (await req.json()) as { inviteToken?: unknown }
    } catch {
      return jsonResponse({ error: 'Invalid JSON payload.' }, 400)
    }

    const callerId = ctx.userClaims?.id ?? ctx.jwtClaims?.sub
    if (!callerId) {
      return jsonResponse({ error: 'Authentication required.' }, 401)
    }

    const rawToken = typeof body.inviteToken === 'string' ? body.inviteToken.trim() : ''
    if (!rawToken) {
      return jsonResponse({ error: 'Missing invite token.' }, 400)
    }

    const { data: userData, error: userError } = await ctx.supabase.auth.getUser()
    if (userError || !userData.user) {
      return jsonResponse({ error: 'Authentication required.' }, 401)
    }

    const { data, error } = await ctx.supabaseAdmin.rpc('accept_family_invite', {
      p_invite_token: rawToken,
      p_accepting_user_id: callerId,
    })

    if (error) {
      console.error('accept-family-invite: failed to accept invite.', error.message)
      return jsonResponse({ error: 'לא ניתן היה לאשר את ההזמנה' }, 400)
    }

    return jsonResponse({ success: true, family: data })
  }),
}
