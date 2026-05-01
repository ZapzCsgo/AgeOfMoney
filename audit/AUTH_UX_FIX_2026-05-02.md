# Auth UX fix — 2026-05-02

Two prelaunch UX bugs unified in one fix :
1. Each "Sign In" button across the app called `signIn()` with a different
   shape (`signIn()`, `signIn('steam')`, custom CSRF-form-POST in Navbar,
   etc.). Most were missing the `callbackUrl` so the user always landed
   back on `/` after Steam OAuth instead of the page they clicked from.
2. On `/matches/[id]`, the score-exact tiles and chat input looked
   interactive when not signed-in but did nothing on click — silent no-op.

## URL Steam OAuth utilisée + flow

Auth lives in **NextAuth.js v4** with the `next-auth-steam` provider
(see `frontend/lib/auth.ts`). Steam OAuth start URL :
- Programmatic : `signIn('steam', { callbackUrl: '<path>' })`
- Direct : `GET /api/auth/signin/steam`

NextAuth handles the open-redirect protection : `callbackUrl` values
that aren't same-origin are rejected server-side, so we can pass the raw
`window.location.pathname + search` without sanitising.

After Steam OAuth redirects back to `/api/auth/callback/steam`, our
`signIn` callback in `frontend/lib/auth.ts` POSTs to
`backend /api/v1/users/auth/login` to create/find the user in Postgres
and gets a backend JWT. NextAuth then redirects the user to `callbackUrl`.

**No backend change needed** for the returnTo flow — NextAuth covers it.

## Hooks / components créés

| File | Purpose |
|------|---------|
| `frontend/lib/authHelpers.ts` | `signInWithSteam(returnTo?, signInFn?)` — single source of truth. Defaults `callbackUrl` to current path. `signInFn` arg is for testing only. |
| `frontend/hooks/useAuth.ts` | Thin `useAuth()` wrapper around `useSession()` exposing `{ user, session, status, isAuthenticated, isLoading, signInWithSteam }`. |
| `frontend/components/auth/RequireAuthAction.tsx` | Reusable button-or-render-prop wrapper that triggers `signInWithSteam()` instead of the gated action when not authenticated. |
| `frontend/lib/__tests__/authHelpers.test.ts` | 5 unit tests covering the no-arg / with-arg / SSR paths. All pass. |

## Components modifiés

### Match page (the screenshot context)
- `frontend/app/matches/[id]/page.tsx` (`ScoreExactBets` component) — each score tile now triggers `signInWithSteam()` if not authenticated, instead of silently selecting state that the user can never act on. Added a one-line "Sign in with Steam to place an exact-score bet" hint under the tiles.
- `frontend/components/matches/BetForm.tsx` — replaced both `signIn()` calls with `signInWithSteam()`. Sign-in CTA inside the form now uses the right label (`auth_signin_steam` instead of generic `auth_signin`).
- `frontend/components/matches/MatchChat.tsx` — the static "Sign in to join the chat" paragraph is now a clickable button that triggers Steam OAuth.

### Global navigation
- `frontend/components/layout/Navbar.tsx` — `handleSteamLogin` rewritten to call `signInWithSteam()`. Old CSRF-form-POST kept ONLY as a fallback in catch (was hardcoding `callbackUrl: window.location.origin` which dropped users on home regardless of source page).
- `frontend/components/layout/LeftSidebar.tsx` — `Profile` / `Deposit` / `Affiliates` items in the sidebar : when not authenticated, the `<Link>` is replaced by a `<button>` that triggers Steam OAuth with the target route as `callbackUrl`. After login the user lands directly on the page they clicked.

### Other call sites (consistency pass)
All converted from `signIn(...)` to `signInWithSteam()` so callbackUrl
is automatic + behaviour is uniform :
- `frontend/components/home/HeroBanner.tsx`
- `frontend/components/wallet/WalletModal.tsx` (2 call sites)
- `frontend/components/rain/RainWidget.tsx`
- `frontend/app/affiliate/page.tsx`
- `frontend/app/coinflip/page.tsx` (2 call sites)
- `frontend/app/jackpot/page.tsx`
- `frontend/app/profile/page.tsx`

## Actions désormais protégées

| Action | Old behaviour (no auth) | New behaviour |
|--------|--------------------------|---------------|
| Score-exact tile click on `/matches/[id]` | Selected visually but no action ever sent | Triggers Steam OAuth, returns to the same match page |
| Winner odd selection inside `BetForm` | Form re-rendered, never submittable | `signInWithSteam()` from the form's submit guard |
| Chat input on `/matches/[id]` | "Sign in to join the chat" plain text | Same line is now a clickable button → Steam OAuth |
| Sidebar `Profile` / `Deposit` / `Affiliates` | Navigated to a page that just shows a sign-in form | Triggers Steam OAuth with the target as callbackUrl, lands on the page after login |
| Header "Sign In with Steam" | Worked but always returned user to `/` (homepage) | Returns user to the page they clicked from |
| Coinflip / jackpot / roulette / hero CTA buttons | All called `signIn('steam')` with no callbackUrl | All return user to the originating page |

## Tests

```bash
$ cd frontend && npx tsx --test lib/__tests__/authHelpers.test.ts
✔ signInWithSteam (no arg) uses window.location.pathname + search as callbackUrl
✔ signInWithSteam(returnTo) honors the explicit returnTo path
✔ signInWithSteam in SSR (no window) calls signIn with no callbackUrl
✔ signInWithSteam(returnTo) in SSR uses the explicit returnTo, no window read
✔ cleanup
ℹ pass 5/5

$ cd frontend && npx tsc --noEmit
# clean
```

## Manual test plan (à faire avant deploy)

1. `npm run dev` côté frontend + backend
2. En mode incognito (non connecté), aller sur `/matches/[id]`
3. Cliquer une tile score-exact (2-0, 2-1, etc.) → doit rediriger vers Steam OAuth
4. Cliquer le bouton "Sign in with Steam" dans la zone PLACE A BET → idem
5. Cliquer "Sign in" sous le chat → idem
6. Cliquer "Sign in with Steam" en haut à droite → idem (redirige vers la page courante après login)
7. Cliquer "Profile" / "Deposit" / "Affiliates" dans la sidebar → idem (lande directement sur la page après login, pas sur `/`)
8. Une fois connecté, refaire ces actions → comportement normal (placement de pari, ouverture du chat, navigation)

## Commit

`<hash à insérer>` `feat(auth): unified Steam sign-in flow + auth-required action guards`

## Risques résiduels

- **Open-redirect** : géré par NextAuth (rejette les callbackUrl externes). Pas d'attention spéciale côté code.
- **CSRF** : NextAuth gère son propre CSRF token sur le flow signin. Le fallback Navbar préserve l'ancien comportement form-POST en catch.
- **Mobile nav** : non touché ce pass car j'ai ciblé les call sites desktop. Si MobileNav.tsx a un bouton sign-in séparé, il garde l'ancien comportement (à vérifier au manual test).
