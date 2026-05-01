'use client';

// CTA triggers the unified Steam OAuth helper (we don't have a /login route —
// auth goes through NextAuth's signIn('steam') flow with the current path
// as callbackUrl).
import { ErrorPage } from '@/components/ErrorPage';
import { signInWithSteam } from '@/lib/authHelpers';

export default function Forbidden() {
  return (
    <ErrorPage
      imageSrc="/errors/403-errors.png"
      imageAlt="403 — Forbidden realm"
      ctaText="🔐 Sign in with Steam"
      ctaOnClick={() => signInWithSteam('/')}
    />
  );
}
