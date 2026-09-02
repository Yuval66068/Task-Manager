// supabase/functions/_shared/childPin.ts
//
// Shared child PIN -> strong Supabase Auth password derivation.
//
// Extracted unchanged from create-child so that create-child and
// child-login use the IDENTICAL algorithm. This file must NOT change the
// derivation output for a given (stableCredentialId, pin, pepper) triple --
// doing so would invalidate every already-created child's password.

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// Derives a strong, deterministic Supabase Auth password from the child's
// stable credential id and the six-digit PIN, using HMAC-SHA-256 with a
// server-only pepper as the HMAC key. Deterministic for the same
// (stableCredentialId, pin, pepper) triple, so the identical derivation can
// be reused unchanged by create-child, child-login, and (later)
// reset-child-pin. The stableCredentialId is NOT the auth user id -- it is
// a server-generated random UUID, deliberately independent of family code,
// username, or the synthetic email text, none of which are suitable as a
// cryptographic salt/identifier.
//
// The digest is hex-encoded (64 lowercase hex characters, using only
// [0-9a-f]) and then given a small fixed prefix that guarantees the result
// satisfies common password-strength rules (length >= 8, at least one
// uppercase letter, one lowercase letter, one digit, one symbol) without
// weakening or otherwise depending on the HMAC output itself. This is a
// fixed, non-secret formatting step -- the actual entropy/secrecy comes
// entirely from the HMAC over the pepper + stable id + PIN.
export async function deriveChildAuthPassword(
  stableCredentialId: string,
  pin: string,
  pepper: string,
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const message = new TextEncoder().encode(`${stableCredentialId}:${pin}`)
  const digestBuffer = await crypto.subtle.sign('HMAC', keyMaterial, message)
  const digestHex = toHex(digestBuffer)

  // Fixed, non-secret composition guaranteeing character-class variety:
  // digestHex is already 64 lowercase-hex characters (satisfies lowercase +
  // digit requirements); prepending a fixed uppercase letter and symbol
  // guarantees the remaining common password-strength classes are present
  // without ever needing to branch on or expose the raw digest differently.
  return `Aa1!${digestHex}`
}
