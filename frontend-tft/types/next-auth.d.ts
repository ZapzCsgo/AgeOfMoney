/**
 * Extend the next-auth Session type so `useSession()` returns the bits
 * we glue on in `lib/auth.ts` (backend JWT, coins, admin flags, steamId).
 *
 * Same shape as AgeOfMoney's frontend/types/index.ts (the backend is
 * shared so the session payload is identical).
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      steamId?: string | null;
      coins: number;
      isAdmin: boolean;
      isOwner: boolean;
      accessToken: string;
    };
  }
}

export {};
