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
 *   - Secure: process.env.NODE_ENV === 'production' (LAN-HTTP dev/prod works)
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
  maxAge: number;
};

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/' as const,
    maxAge: COOKIE_MAX_AGE,
  };
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
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
  });
  const rawValue = extractPbAuthValue(exported);

  const store = await cookies();
  store.set(COOKIE_NAME, rawValue, cookieOptions());

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
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
  });
  const rawValue = extractPbAuthValue(exported);

  const store = await cookies();
  store.set(COOKIE_NAME, rawValue, cookieOptions());

  revalidatePath('/h');
  redirect('/h');
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
