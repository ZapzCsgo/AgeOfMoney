import SteamProvider from 'next-auth-steam';
import type { NextAuthOptions } from 'next-auth';
import type { NextRequest } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * next-auth config for tft.money. Architecture cloned from AgeOfMoney
 * because the backend is shared : same Steam OpenID flow, same JWT issued
 * by `/api/v1/users/auth/login`, same refresh on `/users/me`.
 *
 * The only nuance specific to tft.money : if a user signs in on tft.money
 * for the first time and they already exist on the AgeOfMoney user table
 * (same Steam ID), the backend returns the existing user — so their coins
 * balance and admin status are shared across both sites. Same wallet,
 * two betting surfaces.
 */
export function getAuthOptions(req?: NextRequest): NextAuthOptions {
  return {
    providers: req
      ? [
          SteamProvider(req, {
            clientSecret: process.env.STEAM_SECRET!,
            callbackUrl: `${process.env.NEXTAUTH_URL}/api/auth/callback/steam`,
          }),
        ]
      : [],
    secret: process.env.NEXTAUTH_SECRET,
    session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
    callbacks: {
      async signIn({ user, account, profile }) {
        if (!account || !profile) return false;
        const steamProfile = profile as {
          steamid: string;
          personaname: string;
          avatarfull: string;
          profileurl: string;
        };

        try {
          const response = await fetch(`${API_URL}/api/v1/users/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: 'steam',
              providerId: steamProfile.steamid,
              steamId: steamProfile.steamid,
              username: steamProfile.personaname,
              avatar: steamProfile.avatarfull,
            }),
          });
          if (!response.ok) {
            console.error('Backend auth failed:', await response.text());
            return false;
          }
          const data = (await response.json()) as {
            data: { token: string; user: { id: string; coins: number; isAdmin: boolean; isOwner?: boolean } };
          };
          type ExtUser = typeof user & {
            backendToken?: string; backendId?: string;
            coins?: number; isAdmin?: boolean; isOwner?: boolean; steamId?: string;
          };
          const u = user as ExtUser;
          u.backendToken = data.data.token;
          u.backendId    = data.data.user.id;
          u.coins        = data.data.user.coins;
          u.isAdmin      = data.data.user.isAdmin;
          u.isOwner      = data.data.user.isOwner ?? false;
          u.steamId      = steamProfile.steamid;
          return true;
        } catch (error) {
          console.error('SignIn error:', error);
          return false;
        }
      },

      async jwt({ token, user }) {
        if (user) {
          const u = user as typeof user & {
            backendToken?: string; backendId?: string;
            coins?: number; isAdmin?: boolean; isOwner?: boolean; steamId?: string;
          };
          token.accessToken = u.backendToken ?? '';
          token.userId      = u.backendId ?? '';
          token.coins       = u.coins ?? 0;
          token.isAdmin     = u.isAdmin ?? false;
          token.isOwner     = u.isOwner ?? false;
          token.steamId     = u.steamId ?? '';
        } else if (token.accessToken) {
          // Refresh coins + role flags on every token check.
          try {
            const res = await fetch(`${API_URL}/api/v1/users/me`, {
              headers: { Authorization: `Bearer ${token.accessToken}` },
            });
            if (res.ok) {
              const data = (await res.json()) as {
                data: { coins: number; isAdmin?: boolean; isOwner?: boolean };
              };
              token.coins = data.data.coins;
              if (typeof data.data.isAdmin === 'boolean') token.isAdmin = data.data.isAdmin;
              if (typeof data.data.isOwner === 'boolean') token.isOwner = data.data.isOwner;
            }
          } catch { /* keep existing values */ }
        }
        return token;
      },

      async session({ session, token }) {
        session.user.id          = token.userId as string;
        session.user.coins       = token.coins as number;
        session.user.isAdmin     = token.isAdmin as boolean;
        session.user.isOwner     = (token.isOwner as boolean | undefined) ?? false;
        session.user.accessToken = token.accessToken as string;
        session.user.steamId     = token.steamId as string;
        return session;
      },
    },
    pages: { signIn: '/', error: '/' },
  };
}

export const authOptions: NextAuthOptions = getAuthOptions();
