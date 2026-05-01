/**
 * Minimal auth surface for the rest of the app. Wraps next-auth/react's
 * `useSession` and the local `signInWithSteam` helper so components can
 * pull a single hook instead of importing two libraries.
 *
 *   const { user, isAuthenticated, signInWithSteam } = useAuth();
 *   if (!isAuthenticated) signInWithSteam();
 *
 * Keep this surface thin — components that need richer session data
 * (accessToken, isAdmin, etc.) can still call `useSession()` directly.
 */
import { useSession } from 'next-auth/react';
import { signInWithSteam } from '@/lib/authHelpers';

export function useAuth() {
  const { data: session, status } = useSession();
  return {
    user: session?.user ?? null,
    session,
    status, // 'loading' | 'authenticated' | 'unauthenticated'
    isAuthenticated: status === 'authenticated' && !!session?.user,
    isLoading: status === 'loading',
    signInWithSteam,
  };
}
