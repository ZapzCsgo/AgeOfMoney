# AgeOfMoney — Instructions pour Claude

## UI/Design — RÈGLES STRICTES

### Ressources shadcn/ui à utiliser ABSOLUMENT

- **Icônes** : https://www.shadcn.io/icon — icônes de qualité, dont des icônes crypto (ex: `/icon/cib-btc`, `/icon/cib-eth`, `/icon/cib-usdt`)
- **Backgrounds** : https://www.shadcn.io/background — backgrounds animés, dégradés, grilles, particules prêts à l'emploi
- **Composants** : https://ui.shadcn.com/docs/components — utiliser les vrais composants shadcn (Button, Card, Dialog, Badge, Input, Tabs, ScrollArea, etc.)

### Ne JAMAIS faire
- Inventer des SVG basiques pour les icônes crypto — utiliser les icônes shadcn/ui
- Utiliser des CSS classes génériques inventées — s'appuyer sur shadcn + Tailwind
- Faire des designs "IA" trop lisses et sans caractère — inspiration : CSGOEmpire, CSGORoll, CSGOBig
- Simuler des données — toujours connecter aux vraies APIs (backend Express, aoe4world.com, Liquipedia)

### Toujours faire
- Consulter shadcn.io pour les backgrounds et icônes avant de coder
- Utiliser les variantes et slots des composants shadcn pour la personnalisation
- Référencer des sites comme CSGOEmpire/CSGORoll pour l'inspiration UX betting
- Chat connecté via Socket.io réel (room "global")
- Données matchs depuis l'API backend réelle (`GET /api/v1/matches`)

## Stack technique
- Frontend : Next.js 14 + TailwindCSS + Shadcn/ui
- Backend : Node.js + Express (port 4000)
- BDD : PostgreSQL via Prisma ORM (Supabase)
- Realtime : Socket.io
- Auth : NextAuth.js + Steam uniquement (next-auth-steam@0.4.0)
- Paiements : NOWPayments (crypto) — PAS Stripe
- Hosting : Railway/Render

## Taux de change coins
- Dépôt : $1 = 1.69 ⚜
- Retrait : 1.69 ⚜ = $0.99

## Nom du site
**AgeOfMoney** (pas AOE4BET, pas aoe4bet)

## Palette couleurs
- Fond : `#07060f` (near-black indigo)
- Card : `#0d0b1a`
- Or principal : `#d4a017` / `#f5c842`
- Texte : `#e8e2f5`
- Border : `#1e1a30`
