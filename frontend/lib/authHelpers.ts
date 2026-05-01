/**
 * Single source of truth for Steam sign-in across the app.
 *
 * NextAuth's `signIn('steam', { callbackUrl })` already covers the
 * open-redirect protection (only same-origin URLs are honored). Wrapping
 * it here gives us :
 *   - one place to swap the provider name if we ever re-do auth,
 *   - consistent `callbackUrl` handling (the user lands BACK on the page
 *     they clicked from instead of always `/`),
 *   - a callable inside non-React contexts (toast actions, native button
 *     handlers, etc.) without re-importing next-auth/react every time.
 */
import { signIn } from 'next-auth/react';

/**
 * Subset of next-auth's `signIn` that this helper actually uses.
 * Exported so the unit tests can swap in a stub without monkey-patching
 * the whole `next-auth/react` module — see `__tests__/authHelpers.test.ts`.
 */
export type SignInFn = (provider?: string, opts?: { callbackUrl?: string }) => unknown;

/**
 * Trigger Steam OAuth. Optional `returnTo` is the path the user should
 * land on after a successful login. Defaults to the current path.
 *
 * NextAuth automatically rejects external `callbackUrl` values, so it's
 * safe to pass the raw `window.location.pathname + search`.
 *
 * The optional `signInFn` arg is for tests only — production calls always
 * use the real next-auth signIn.
 */
export function signInWithSteam(returnTo?: string, signInFn: SignInFn = signIn): void {
  if (typeof window === 'undefined') {
    void signInFn('steam');
    return;
  }
  const callbackUrl = returnTo ?? (window.location.pathname + window.location.search);
  void signInFn('steam', { callbackUrl });
}
