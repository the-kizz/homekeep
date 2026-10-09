import { randomBytes } from 'node:crypto';

/**
 * Generate a URL-safe, cryptographically random invite token.
 *
 * `randomBytes(24)` = 192 bits of entropy → 32-char base64url string.
 * Birthday-collision probability crosses 1e-9 only after ~9e13 tokens
 * (far beyond any realistic HomeKeep household count), and the `token`
 * column has a UNIQUE index on the `invites` collection
 * (`1714953601_invites.js`) as belt-and-braces against any conceivable
 * collision.
 *
 * base64url encoding (Node 16+):
 *   - replaces `+` with `-`, `/` with `_`, strips padding
 *   - matches D-02's "URL-safe" requirement — no `encodeURIComponent`
 *     is needed or wanted (base64url chars pass through URL paths
 *     and query strings unmodified)
 *
 * Matches D-18 unit-test expectations: length === 32 and matches
 * /^[A-Za-z0-9_-]+$/.
 *
 * Why NOT `crypto.randomUUID()`: UUID v4 is 128 bits → 22 base64url
 * chars after dash-strip, which misses D-02's "32-char" spec.
 * `randomBytes(24)` hits the spec exactly.
 */
export function generateInviteToken(): string {
  return randomBytes(24).toString('base64url');
}
