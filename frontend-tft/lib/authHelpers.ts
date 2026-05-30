/**
 * Single source of truth for Steam sign-in on tft.money.
 *
 * Mirrors AgeOfMoney's helper so game pages ported from AoM can call
 * `signInWithSteam()` without a re-import. NextAuth automatically rejects
 * external `callbackUrl` values, so passing the raw current pathname is
 * safe — the user lands back where they were after authenticating.
 */
import { signIn } from 'next-auth/react';

export type SignInFn = (provider?: string, opts?: { callbackUrl?: string }) => unknown;

export function signInWithSteam(returnTo?: string, signInFn: SignInFn = signIn): void {
  if (typeof window === 'undefined') {
    void signInFn('steam');
    return;
  }
  const callbackUrl = returnTo ?? (window.location.pathname + window.location.search);
  void signInFn('steam', { callbackUrl });
}
