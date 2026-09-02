// supabase/functions/create-child/index.ts
//
// PHASE ONBOARDING-2B (revised) — secure "create child" Edge Function.
//
// Lets an AUTHENTICATED PARENT create a new child account for their own
// family. Called directly by the frontend with the parent's own session
// (JWT) -- this is NOT a webhook and NOT a service-to-service function, so
// it uses @supabase/server's withSupabase({ auth: 'user' }) rather than the
// 'secret' mode used by send-push-notification. Platform-level JWT
// verification stays ENABLED for this function (verify_jwt = true in
// supabase/config.toml) -- unlike send-push-notification, this must never
// be deployed with --no-verify-jwt.
//
// The parent supplies only: fullName, childUsername, pin. Everything else
// (which family, whether the caller is actually a parent, the child's auth
// user id, the synthetic email, the actual Auth password) is derived or
// generated server-side and is never trusted from the request body.
//
// The child remains a REAL Supabase Auth user, but the child's UX-facing
// six-digit PIN is NEVER used directly as the Supabase Auth password.
// Supabase's project-wide password policy may require >=8 characters and
// mixed character classes, and using the raw PIN directly would either
// violate that policy or force it to be weakened for everyone (including
// parents). Instead, a strong Auth password is deterministically derived
// from (a server-generated stable child credential id, the PIN, and a
// server-only pepper) via HMAC-SHA-256. Supabase Auth is still the only
// place any credential material is ultimately stored (hashed internally,
// exactly like every other Supabase Auth password) -- this function itself
// never persists the raw PIN, the derived password, or the pepper
// anywhere, and never logs any of them.

import { withSupabase } from 'npm:@supabase/server@^1'
import { deriveChildAuthPassword } from '../_shared/childPin.ts'

type CreateChildRequestBody = {
  fullName?: unknown
  childUsername?: unknown
  pin?: unknown
}

type ValidatedInput = {
  fullName: string
  childUsername: string
  pin: string
}

const MAX_FULL_NAME_LENGTH = 100
const MAX_USERNAME_LENGTH = 30
const PIN_PATTERN = /^\d{6}$/
const SYNTHETIC_EMAIL_DOMAIN = 'child.internal.familytasks.invalid'

// Postgres unique_violation SQLSTATE, and the exact constraint name enforced
// by 013_child_username.sql. Used to map a race-condition duplicate-username
// failure to a generic, user-safe message via error CODE/constraint name --
// never by pattern-matching arbitrary error message text.
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505'
const CHILD_USERNAME_UNIQUE_CONSTRAINT = 'family_members_child_username_unique_per_family'

const CHILD_PIN_PEPPER = Deno.env.get('CHILD_PIN_PEPPER')

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Every rejection returned to the client is intentionally generic --
// never echoes back which specific field/rule failed in more detail than
// necessary, and never includes internal error text.
function validationError(message: string): Response {
  return jsonResponse({ error: message }, 400)
}

function validateInput(body: CreateChildRequestBody): ValidatedInput | { error: string } {
  const rawFullName = body.fullName
  const rawChildUsername = body.childUsername
  const rawPin = body.pin

  if (typeof rawFullName !== 'string') {
    return { error: 'fullName is required.' }
  }
  const fullName = rawFullName.trim()
  if (fullName.length === 0) {
    return { error: 'fullName is required.' }
  }
  if (fullName.length > MAX_FULL_NAME_LENGTH) {
    return { error: 'fullName is too long.' }
  }

  if (typeof rawChildUsername !== 'string') {
    return { error: 'childUsername is required.' }
  }
  const childUsername = rawChildUsername.trim()
  if (childUsername.length === 0) {
    return { error: 'childUsername is required.' }
  }
  if (childUsername.length > MAX_USERNAME_LENGTH) {
    return { error: 'childUsername is too long.' }
  }

  // PIN is validated and used as a *string* throughout -- never converted
  // to a number -- so a value like "000123" keeps its leading zeroes.
  if (typeof rawPin !== 'string' || !PIN_PATTERN.test(rawPin)) {
    return { error: 'pin must be exactly 6 digits.' }
  }

  return { fullName, childUsername, pin: rawPin }
}

// Generates a synthetic, internal-only email for the child's Supabase Auth
// account. Deliberately NOT derived from the family code or the username
// alone (both of which could otherwise make the address guessable/
// predictable) -- it is a fresh random identifier combined with a fixed
// internal domain, so it is unique per attempt as well as unpredictable.
// This address is only ever used internally as a GoTrue identifier; it is
// never shown in any UI and never returned in any response.
function generateSyntheticEmail(): string {
  const randomId = crypto.randomUUID()
  return `child.${randomId}@${SYNTHETIC_EMAIL_DOMAIN}`
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req: Request, ctx) => {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    if (!CHILD_PIN_PEPPER) {
      console.error('create-child misconfigured: missing CHILD_PIN_PEPPER environment variable.')
      return jsonResponse({ error: 'Child account creation is not configured.' }, 500)
    }

    // ctx.userClaims is populated only because withSupabase's 'user' auth
    // mode already validated the caller's JWT before this handler ran.
    const callerId = ctx.userClaims?.id ?? ctx.jwtClaims?.sub

    if (!callerId) {
      return jsonResponse({ error: 'Authentication required.' }, 401)
    }

    let body: CreateChildRequestBody
    try {
      body = (await req.json()) as CreateChildRequestBody
    } catch (error) {
      console.error('create-child: failed to parse request body as JSON.', error)
      return validationError('Invalid JSON payload.')
    }

    const validated = validateInput(body)
    if ('error' in validated) {
      return validationError(validated.error)
    }

    const { fullName, childUsername, pin } = validated

    // ==================================================================
    // Authorization: derive family + role exclusively from the caller's
    // own family_members rows via the RLS-scoped client (ctx.supabase).
    // Never trust a client-supplied familyId. family_members.role remains
    // the authorization source of truth -- profiles.role is never
    // consulted here.
    // ==================================================================
    const { data: memberships, error: membershipsError } = await ctx.supabase
      .from('family_members')
      .select('family_id, role')
      .eq('user_id', callerId)

    if (membershipsError) {
      console.error('create-child: failed to load caller memberships.', membershipsError.message)
      return jsonResponse({ error: 'Unable to verify authorization.' }, 500)
    }

    if (!memberships || memberships.length !== 1) {
      // No family, or an unexpected multi-family state: reject safely
      // rather than guessing which family was intended.
      console.error(
        `create-child: rejected caller ${callerId} with unexpected membership count (${memberships?.length ?? 0}).`,
      )
      return jsonResponse({ error: 'Not authorized to create a child account.' }, 403)
    }

    const membership = memberships[0]

    if (membership.role !== 'parent') {
      console.error(`create-child: rejected non-parent caller ${callerId}.`)
      return jsonResponse({ error: 'Not authorized to create a child account.' }, 403)
    }

    const familyId = membership.family_id

    // ==================================================================
    // Optional UX-only pre-check for username uniqueness (case-insensitive,
    // within this family). This is a convenience for a fast/friendly
    // rejection only -- the database's partial unique index
    // (family_members_child_username_unique_per_family, 013_child_username.sql)
    // remains the sole final authority and is enforced again below inside
    // finalize_created_child regardless of this pre-check's outcome.
    // ==================================================================
    const { data: existingUsernames, error: existingUsernamesError } = await ctx.supabaseAdmin
      .from('family_members')
      .select('child_username')
      .eq('family_id', familyId)
      .eq('role', 'child')
      .not('child_username', 'is', null)

    if (existingUsernamesError) {
      console.error('create-child: failed to check username uniqueness.', existingUsernamesError.message)
      return jsonResponse({ error: 'Unable to validate username.' }, 500)
    }

    const normalizedRequested = childUsername.trim().toLowerCase()
    const usernameTaken = (existingUsernames ?? []).some(
      (row) => (row.child_username ?? '').trim().toLowerCase() === normalizedRequested,
    )

    if (usernameTaken) {
      return validationError('שם המשתמש כבר נמצא בשימוש במשפחה')
    }

    // ==================================================================
    // Generate a stable, random child credential id BEFORE creating the
    // Auth user (the Auth user id does not exist yet at this point, and is
    // deliberately not used as the derivation salt/identifier anyway).
    // This id is not a password/secret; it may be safely stored as
    // non-secret metadata to allow reset-child-pin/child-login to reuse
    // the identical derivation later. It is stored in the Auth user's own
    // app_metadata (child_credential_id) -- the smallest safe place, since
    // it must already be reachable given only the auth user, without
    // requiring any new public table/column. app_metadata (not
    // user_metadata) is used because it cannot be modified by the user
    // themselves via their own session.
    // ==================================================================
    const stableCredentialId = crypto.randomUUID()
    const derivedPassword = await deriveChildAuthPassword(stableCredentialId, pin, CHILD_PIN_PEPPER)

    // ==================================================================
    // Create the child's Supabase Auth user with the DERIVED strong
    // password -- never the raw PIN. Admin-only operation, requires
    // ctx.supabaseAdmin (service role), never exposed to the frontend.
    // ==================================================================
    const syntheticEmail = generateSyntheticEmail()

    const { data: createdAuthUser, error: createAuthUserError } = await ctx.supabaseAdmin.auth.admin.createUser({
      email: syntheticEmail,
      password: derivedPassword,
      email_confirm: true,
      app_metadata: {
        is_synthetic_child_account: true,
        child_credential_id: stableCredentialId,
      },
    })

    if (createAuthUserError || !createdAuthUser?.user) {
      console.error('create-child: failed to create auth user.', createAuthUserError?.message ?? 'unknown error')
      return jsonResponse({ error: 'Unable to create child account.' }, 500)
    }

    const childUserId = createdAuthUser.user.id

    // From this point on, if anything fails we attempt to delete the
    // orphaned auth user (compensating cleanup) since Auth user creation
    // and the following Postgres work cannot share one native transaction.
    const cleanupOrphanedAuthUser = async (stage: string, details: string) => {
      console.error(`create-child: rolling back after failure at stage "${stage}" for child ${childUserId}.`, details)

      const { error: deleteError } = await ctx.supabaseAdmin.auth.admin.deleteUser(childUserId)

      if (deleteError) {
        console.error(
          `create-child: CLEANUP FAILED -- orphaned auth user ${childUserId} could not be deleted.`,
          deleteError.message,
        )
      }
    }

    // ==================================================================
    // Finalize: create the profile + family_members rows via the
    // service_role-only public.finalize_created_child RPC. Called
    // exclusively through ctx.supabaseAdmin (service role) -- never
    // through ctx.supabase -- since this RPC is not granted to
    // authenticated/anon at all. finalize_created_child independently
    // re-verifies that callerId is a parent member of familyId; it never
    // trusts this Edge Function's own prior authorization check alone.
    // ==================================================================
    const { data: finalizeResult, error: finalizeError } = await ctx.supabaseAdmin.rpc('finalize_created_child', {
      p_parent_user_id: callerId,
      p_family_id: familyId,
      p_child_user_id: childUserId,
      p_child_email: syntheticEmail,
      p_child_full_name: fullName,
      p_child_username: childUsername,
    })

    if (finalizeError) {
      const isDuplicateUsername =
        finalizeError.code === POSTGRES_UNIQUE_VIOLATION_CODE &&
        (finalizeError as { message?: string; details?: string }).message?.includes(
          CHILD_USERNAME_UNIQUE_CONSTRAINT,
        )

      await cleanupOrphanedAuthUser('finalize_created_child', finalizeError.message)

      if (isDuplicateUsername) {
        return validationError('שם המשתמש כבר נמצא בשימוש במשפחה')
      }

      return jsonResponse({ error: 'Unable to create child account.' }, 500)
    }

    console.log(`create-child: parent=${callerId} family=${familyId} created child=${childUserId}`)

    const finalizedChild = Array.isArray(finalizeResult) ? finalizeResult[0] : finalizeResult

    return jsonResponse({
      child: {
        id: finalizedChild?.id ?? childUserId,
        fullName: finalizedChild?.full_name ?? fullName,
        childUsername: finalizedChild?.child_username ?? childUsername,
      },
    })
  }),
}
