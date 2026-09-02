// supabase/functions/child-login/index.ts
//
// PHASE — CHILD LOGIN EDGE FUNCTION.
//
// Intentionally a PUBLIC login endpoint: called by an unauthenticated
// browser before any session exists, so it uses @supabase/server's
// withSupabase({ auth: 'none' }) (no credentials required at the platform
// level) rather than 'user' (used by create-child, which requires an
// already-authenticated parent). Because this is a non-'user'/non-'secret'/
// non-'publishable' mode, platform-level JWT verification must be disabled
// for this function only (verify_jwt = false in supabase/config.toml) --
// this does NOT affect create-child's verify_jwt = true.
//
// Given { familyCode, childUsername, pin }, this function looks up the
// matching child (server-side/admin only), recreates the same strong Auth
// password used at create-child time via the shared PIN derivation helper,
// and signs in through NORMAL Supabase Auth email/password sign-in. No
// custom tokens are minted; Supabase Auth remains the sole session
// authority. Every failure path (unknown family, unknown username, wrong
// PIN, invalid synthetic-account metadata) returns the exact same generic
// response, so the client can never distinguish which input was wrong.

import { withSupabase } from 'npm:@supabase/server@^1'
import { deriveChildAuthPassword } from '../_shared/childPin.ts'

type ChildLoginRequestBody = {
  familyCode?: unknown
  childUsername?: unknown
  pin?: unknown
}

type ValidatedInput = {
  familyCode: string
  childUsername: string
  pin: string
}

const FAMILY_CODE_LENGTH = 6
// Same alphabet as private.generate_family_code() in 012_family_code.sql
// (excludes 0/O/1/I to avoid visual ambiguity).
const FAMILY_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/
const MAX_USERNAME_LENGTH = 30
const PIN_PATTERN = /^\d{6}$/

const CHILD_PIN_PEPPER = Deno.env.get('CHILD_PIN_PEPPER')

// Every failure returns this exact same generic response -- never reveals
// which specific input (family code, username, or PIN) was incorrect, and
// never echoes back internal lookup/auth error details.
const GENERIC_INVALID_LOGIN = { error: 'קוד המשפחה, שם המשתמש או קוד ה-PIN שגויים' }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function invalidLoginResponse(): Response {
  return jsonResponse(GENERIC_INVALID_LOGIN, 401)
}

function validateInput(body: ChildLoginRequestBody): ValidatedInput | null {
  const rawFamilyCode = body.familyCode
  const rawChildUsername = body.childUsername
  const rawPin = body.pin

  if (typeof rawFamilyCode !== 'string') {
    return null
  }
  const familyCode = rawFamilyCode.trim().toUpperCase()
  if (familyCode.length !== FAMILY_CODE_LENGTH || !FAMILY_CODE_PATTERN.test(familyCode)) {
    return null
  }

  if (typeof rawChildUsername !== 'string') {
    return null
  }
  const childUsername = rawChildUsername.trim()
  if (childUsername.length === 0 || childUsername.length > MAX_USERNAME_LENGTH) {
    return null
  }

  // PIN is validated and used as a *string* throughout -- never converted
  // to a number -- so a value like "000123" keeps its leading zeroes.
  if (typeof rawPin !== 'string' || !PIN_PATTERN.test(rawPin)) {
    return null
  }

  return { familyCode, childUsername, pin: rawPin }
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req: Request, ctx) => {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    if (!CHILD_PIN_PEPPER) {
      console.error('child-login misconfigured: missing CHILD_PIN_PEPPER environment variable.')
      return jsonResponse({ error: 'Child login is not configured.' }, 500)
    }

    let body: ChildLoginRequestBody
    try {
      body = (await req.json()) as ChildLoginRequestBody
    } catch (error) {
      console.error('child-login: failed to parse request body as JSON.', error)
      return invalidLoginResponse()
    }

    const validated = validateInput(body)
    if (!validated) {
      // Malformed input is treated identically to a wrong credential --
      // never a distinct "bad request" shape that could leak validation
      // rules to an attacker.
      return invalidLoginResponse()
    }

    const { familyCode, childUsername, pin } = validated

    // ==================================================================
    // Server-side/admin-only child lookup. Never exposes family UUID,
    // credential id, synthetic email, or any other internal identifier in
    // a response -- only ever used internally within this function.
    // ==================================================================
    const { data: family, error: familyError } = await ctx.supabaseAdmin
      .from('families')
      .select('id')
      .eq('family_code', familyCode)
      .maybeSingle()

    if (familyError) {
      console.error('child-login: family lookup failed.', familyError.message)
      return invalidLoginResponse()
    }

    if (!family) {
      return invalidLoginResponse()
    }

    const { data: members, error: membersError } = await ctx.supabaseAdmin
      .from('family_members')
      .select('user_id, child_username')
      .eq('family_id', family.id)
      .eq('role', 'child')
      .not('child_username', 'is', null)

    if (membersError) {
      console.error('child-login: family_members lookup failed.', membersError.message)
      return invalidLoginResponse()
    }

    const normalizedRequestedUsername = childUsername.toLowerCase()
    const matchedMember = (members ?? []).find(
      (member) => (member.child_username ?? '').trim().toLowerCase() === normalizedRequestedUsername,
    )

    if (!matchedMember) {
      return invalidLoginResponse()
    }

    const { data: authUserResult, error: authUserError } = await ctx.supabaseAdmin.auth.admin.getUserById(
      matchedMember.user_id,
    )

    if (authUserError || !authUserResult?.user) {
      console.error(
        'child-login: failed to load auth user for matched child.',
        authUserError?.message ?? 'unknown error',
      )
      return invalidLoginResponse()
    }

    const authUser = authUserResult.user
    const appMetadata = (authUser.app_metadata ?? {}) as Record<string, unknown>
    const stableCredentialId = appMetadata.child_credential_id
    const isSyntheticChildAccount = appMetadata.is_synthetic_child_account

    if (isSyntheticChildAccount !== true || typeof stableCredentialId !== 'string' || stableCredentialId.length === 0) {
      console.error(
        `child-login: matched user ${authUser.id} is missing valid synthetic-child app_metadata.`,
      )
      return invalidLoginResponse()
    }

    const syntheticEmail = authUser.email
    if (!syntheticEmail) {
      console.error(`child-login: matched user ${authUser.id} has no email on record.`)
      return invalidLoginResponse()
    }

    // Recreate the exact same strong Auth password derived at create-child
    // time -- never store/compare the raw PIN itself.
    const derivedPassword = await deriveChildAuthPassword(stableCredentialId, pin, CHILD_PIN_PEPPER)

    // Authenticate through NORMAL Supabase Auth email/password sign-in.
    // ctx.supabase here is the anonymous/RLS-scoped client (this function
    // uses auth: 'none', so there is no caller identity yet) -- exactly the
    // same client an ordinary frontend sign-in call would use.
    const { data: signInData, error: signInError } = await ctx.supabase.auth.signInWithPassword({
      email: syntheticEmail,
      password: derivedPassword,
    })

    if (signInError || !signInData.session) {
      // Never logs the PIN, the derived password, the pepper, or the
      // synthetic email -- only a generic technical note.
      console.error('child-login: sign-in failed for matched child.', signInError?.message ?? 'no session returned')
      return invalidLoginResponse()
    }

    const { access_token, refresh_token, expires_in, token_type } = signInData.session

    return jsonResponse({
      access_token,
      refresh_token,
      expires_in,
      token_type,
    })
  }),
}
