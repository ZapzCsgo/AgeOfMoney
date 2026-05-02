'use client';

// CTA triggers the unified Steam OAuth helper (we don't have a /login route —
// auth goes through NextAuth's signIn('steam') flow with the current path
// as callbackUrl).
import { ErrorPage } from '@/components/ErrorPage';
import { signInWithSteam } from '@/lib/authHelpers';

export default function Forbidden() {
  return (
    <ErrorPage
      errorCode="403"
      title="FORBIDDEN"
      subtitle="You don't have permission to enter this realm."
      ctaText="🔐 Sign in with Steam"
      ctaOnClick={() => signInWithSteam('/')}
    />
  );
}
