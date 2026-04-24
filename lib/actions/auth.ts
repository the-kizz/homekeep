'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/pocketbase-server';
import {
  loginSchema,
  signupSchema,
  resetRequestSchema,
  resetConfirmSchema,
  type ActionState,
} from '@/lib/schemas/auth';

/**
 * Auth server actions (02-03 Plan).
 *
 * Five exports: loginAction, signupAction, logoutAction, requestResetAction,
 * confirmResetAction. Each is a Next 16 React Server Action consumed by
 * useActionState on the corresponding form component.
 *
 * Cookie contract (D-03 + RESEARCH Pitfall 3/4):
 *   - Name: pb_auth
 *   - HttpOnly: true (JS cannot read — cookie is same-origin only)
 *   - Secure: derived from SITE_URL (https:// → true; http:// → false).
 *     v1.2.1: previously NODE_ENV-gated, which broke LAN-HTTP prod deploys
 *     because browsers drop Secure cookies over plain HTTP.
 *   - SameSite: 'lax' (cross-site form posts blocked; top-level nav allowed)
 *   - Path: '/'
 *   - Max-Age: 14 days (matches PB default authTokenDuration)
 *
 * Value contract: pb.authStore.exportToCookie() returns a FULL Set-Cookie
 * header string ("pb_auth=<value>; HttpOnly; ..."). Next's cookies().set()
 * expects the value alone + options separately, so we extract the value via
 * extractPbAuthValue().
 */

const COOKIE_NAME = 'pb_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 14; // 14 days (A3)

type CookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  // v1.2.1: optional — omit to produce a session cookie (browser drops
  // on close). Used when Remember Me is unchecked on login.
  maxAge?: number;
};

/**
 * v1.2.1 cookie-secure fix: derive Secure from SITE_URL protocol, not
 * NODE_ENV. A LAN-HTTP production deployment (SITE_URL=http://...)
 * with NODE_ENV=production was setting Secure=true, which causes
 * browsers to drop the cookie over plain HTTP. That broke signup →
 * create-home flow on 46.62.151.57:3000 (surfaced by v1.2 live smoke).
 *
 * Rule: Secure=true ONLY when SITE_URL begins with `https://`. This
 * handles localhost dev, LAN-HTTP production, AND public-HTTPS
 * correctly — the common denominator is "does the user see HTTPS?".
 */
function isSecureSite(): boolean {
  const siteUrl = process.env.SITE_URL ?? '';
  return siteUrl.startsWith('https://');
}

/**
 * v1.2.1 Remember-me support: when `rememberMe` is false, omit `maxAge`
 * so the cookie becomes a session cookie (browser deletes on close).
 * Default behavior (rememberMe=true) keeps the 14-day persistent cookie.
 */
function cookieOptions(rememberMe: boolean = true): CookieOptions {
  const base = {
    httpOnly: true as const,
    secure: isSecureSite(),
    sameSite: 'lax' as const,
    path: '/' as const,
  };
  if (rememberMe) {
    return { ...base, maxAge: COOKIE_MAX_AGE };
  }
  // Session cookie: no maxAge → browser drops on close.
  return { ...base, maxAge: undefined };
}

/**
 * Validate a post-auth redirect target. Only same-origin paths beginning
 * with a single '/' are allowed; this rules out protocol-relative
 * '//evil.com', schemed 'http://...', and fragments/empties. (T-02-03-08)
 */
function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (typeof next !== 'string') return null;
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//')) return null;
  if (next.includes('://')) return null;
  return next;
}

export async function loginAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw = Object.fromEntries(formData);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const nextTarget = safeNext(String(formData.get('next') ?? '')) ?? '/h';
  // v1.2.1: Remember Me checkbox — present + value "on" means the user
  // wants the 14-day persistent cookie. Unchecked → session cookie.
  // Default (no field at all, e.g. SDK/API login) is persistent.
  const rememberMeRaw = formData.get('rememberMe');
  const rememberMe = rememberMeRaw === null || rememberMeRaw === 'on';

  const pb = await createServerClient();
  try {
    await pb.collection('users').authWithPassword(
      parsed.data.email,
      parsed.data.password,
    );
  } catch {
    // Generic error — do not leak whether the email exists (T-02-03-03).
    return { ok: false, formError: 'Invalid email or password' };
  }

  const exported = pb.authStore.exportToCookie({
    httpOnly: true,
    secure: isSecureSite(),
    sameSite: 'Lax',
  });
  const rawValue = extractPbAuthValue(exported);

  const store = await cookies();
  store.set(COOKIE_NAME, rawValue, cookieOptions(rememberMe));

  revalidatePath('/h');
  redirect(nextTarget);
}

export async function signupAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw = Object.fromEntries(formData);
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const pb = await createServerClient();
  try {
    await pb.collection('users').create({
      email: parsed.data.email,
      password: parsed.data.password,
      passwordConfirm: parsed.data.passwordConfirm,
      name: parsed.data.name,
    });
    await pb.collection('users').authWithPassword(
      parsed.data.email,
      parsed.data.password,
    );
  } catch (err: unknown) {
    // PB returns ClientResponseError with .response.data on validation.
    // The "email already in use" error surfaces as
    //   err.response.data.email.code === 'validation_not_unique'
    // (PB 0.23+). Older versions used 'validation_invalid_email'; handle both.
    const e = err as {
      status?: number;
      response?: { data?: Record<string, { code?: string } | undefined> };
    };
    const emailCode = e?.response?.data?.email?.code;
    if (
      emailCode === 'validation_not_unique' ||
      emailCode === 'validation_invalid_email'
    ) {
      return { ok: false, fieldErrors: { email: ['Email already registered'] } };
    }
    return { ok: false, formError: 'Could not create account' };
  }

  const exported = pb.authStore.exportToCookie({
    httpOnly: true,
    secure: isSecureSite(),
    sameSite: 'Lax',
  });
  const rawValue = extractPbAuthValue(exported);

  const store = await cookies();
  store.set(COOKIE_NAME, rawValue, cookieOptions());

  // 04-02 signup-next (Pitfall 5): if the signup form threaded a `next`
  // value through (e.g. /signup?next=/invite/TOKEN), redirect there.
  // safeNext enforces same-origin + `/`-prefix + forbids `//` and `:`
  // so /invite/TOKEN passes while an attacker-crafted //evil.com does
  // not. Falls back to /h (the default post-signup landing).
  const nextTarget = safeNext(String(formData.get('next') ?? '')) ?? '/h';

  revalidatePath('/h');
  redirect(nextTarget);
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  revalidatePath('/', 'layout');
  redirect('/login');
}

export async function requestResetAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw = Object.fromEntries(formData);
  const parsed = resetRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const pb = await createServerClient();
  try {
    await pb.collection('users').requestPasswordReset(parsed.data.email);
  } catch (err: unknown) {
    // D-02 graceful degradation: PB returns 400 when SMTP is not configured.
    const e = err as { status?: number };
    if (e?.status === 400) {
      return {
        ok: false,
        formError: 'Password reset unavailable — contact admin',
      };
    }
    // Any other error: do NOT leak whether the email exists (T-02-03-03).
    // Fall through to the generic success state.
  }
  // Always return ok on unknown / account-not-found errors so an attacker
  // can't probe the user base via timing or error surface.
  return { ok: true };
}

export async function confirmResetAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw = Object.fromEntries(formData);
  const parsed = resetConfirmSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const pb = await createServerClient();
  try {
    await pb.collection('users').confirmPasswordReset(
      parsed.data.token,
      parsed.data.password,
      parsed.data.passwordConfirm,
    );
  } catch {
    return {
      ok: false,
      formError: 'Could not reset password — the link may have expired',
    };
  }
  return { ok: true };
}

/**
 * exportToCookie returns a full Set-Cookie header:
 *   "pb_auth=<url-encoded-json>; HttpOnly; Path=/; Max-Age=..."
 * Next's cookies().set() takes the value + options separately; extract
 * just the value portion (everything between the first '=' and the first ';').
 * (RESEARCH Pitfall 4.)
 */
function extractPbAuthValue(setCookieHeader: string): string {
  const first = setCookieHeader.split(';')[0] ?? '';
  const eq = first.indexOf('=');
  return eq === -1 ? '' : first.slice(eq + 1);
}
