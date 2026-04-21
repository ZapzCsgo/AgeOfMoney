# Jackpot — recherche étape 0 (consolidation 5 agents)

Date : 2026-04-21
Auteur : recherche parallèle (5 agents), consolidation Claude
Statut : **ATTENTE VALIDATION USER avant étape 1 (backend)**

Spec rappelée (message user) : MIN BET = 1 ⚜ · MAX BET = 5 000 ⚜ · RAKE = 5 % · TIMER = 90 s · RNG = Random.org Signed API avec fallback HMAC-SHA256 · commit-reveal hybride · pas de feature flag · push direct master.

---

## Agent 1 — scan GitHub des libs roulette/jackpot React

**Verdict** : 1 seul candidat sérieux en 2025-2026, `react-roulette-pro`.

| Critère | Valeur |
|---|---|
| Stars | 87 (modeste mais stable) |
| Dernier commit | 2025-06 |
| Licence | MIT |
| TypeScript | Oui |
| Orientation | Horizontale (pattern CSGO classique) |
| Deps | légère |

**Décision conseillée** : **NE PAS l'adopter tel quel**. Le look daterait (thème CS:GO old-school, couleurs jaune/noir, anim naïve). Plutôt re-moderniser : prendre l'idée (wheel horizontale défilante + pointeur fixe + easing décéléré sur ~5-8 s) mais l'implémenter nous-mêmes en framer-motion pour matcher la palette AgeOfMoney (`#07060f` / or `#d4a017`).

**Pourquoi pas de lib** :
- 1 seule dep inutile à maintenir
- notre wheel doit intégrer les avatars Steam + couleur par user → custom de toute façon
- framer-motion est déjà prêt à gérer ça

---

## Agent 2 — patterns visuels CSGO (CSGOEmpire, CSGORoll, CSGOBig, CSGOLotto)

**Top 5 patterns à reproduire** (par ordre d'impact UX) :

1. **Wheel horizontale défilante** — bandeau horizontal d'avatars (taille proportionnelle à la mise), pointeur vertical central fixe. Décélération cubic-bezier(0.15, 0.45, 0.3, 1) sur 5-8 s. Dernière frame centrée sur le gagnant, puis léger "bounce".
2. **Pot count-up temps réel** — chaque nouvelle mise fait tick le total visible (animation de chiffre façon slot, 400 ms). Plus le pot grossit, plus ça donne envie de sauter dedans.
3. **Timer circulaire** — anneau SVG qui se vide sur 90 s. Les 10 dernières secondes : pulse rouge + son "tick" optionnel.
4. **Liste participants** — barre segmentée par joueur (largeur = % du pot), colorée, avec avatar + pseudo + mise + **chance %** calculée en live. C'est ce qui fait "vivre" le jackpot quand le timer descend.
5. **Confetti + winner reveal** — à la fin de la roulette, confetti or (`canvas-confetti`, `colors: ['#d4a017', '#f5c842', '#ffffff']`) + overlay gagnant 2 s avec son pseudo + gain net.

**Autres détails** : avatar ring or pour le gagnant, sound on/off togglable (préférence localStorage), pattern "last 10 winners" en haut.

---

## Agent 3 — libs d'animation (framer-motion vs alternatives)

**Verdict** : **framer-motion pour tout** (déjà installé). Ajouter **une seule** nouvelle dep : `canvas-confetti` (2.3 KB gzip, zéro dépendance, API `confetti({ particleCount, spread, origin })`).

Pourquoi :
- framer-motion gère parfaitement un défilement contrôlé (`animate={{ x: -targetX }} transition={{ duration: 6, ease: [0.15, 0.45, 0.3, 1] }}`)
- le tick du pot : `<motion.span key={pot}>` avec `AnimatePresence` sur changement de valeur
- le pulse timer : `motion.div` avec `animate={{ scale: [1, 1.05, 1] }}` en loop
- pas besoin de GSAP, lottie, ou lib dédiée roulette

**À ne PAS installer** :
- `react-spring` (fait double emploi)
- `gsap` (payant pour usage commercial sur certains plugins)
- libs roulette dédiées (cf. agent 1)

---

## Agent 4 — patterns dopaminergiques (retention / FOMO)

**7 patterns prioritaires** pour notre MVP :

1. **Win % ticker live** — chaque user voit sa propre probabilité en gros sur le côté. Bouger le ticker à chaque nouvelle mise crée du stress positif ("quelqu'un vient de baisser mes chances, je remise ?").
2. **Pot count-up animé** — déjà listé agent 2, rappel crucial pour la dopamine.
3. **Timer pulse 10s final** — "dernière chance de rentrer".
4. **Whale alert toast** — si un user mise ≥ 1 000 ⚜, popup transversale "🐋 @user vient de miser 1 500 ⚜". Crée du spectacle.
5. **Winner reveal avec roulette** — pas juste afficher "X gagne", jouer l'animation 5-8 s. Le cerveau du gagnant libère plus de dopamine sur l'anticipation que sur le résultat lui-même.
6. **1-click rebet** — après une perte, bouton "Rejouer même mise" visible 20 s. Baisse la friction, augmente le volume.
7. **Live activity feed** — bandeau permanent en haut "@userA +2 400 · @userB +890 · ..." qui scrolle. Social proof + FOMO.

**À NE PAS faire** (garde-fous) : pas de "near miss" fake (montrer que le user était "à 2 cases" alors que c'est statistiquement faux). Pas de "loss disguised as win". Pas de limite de temps pour retirer ses gains.

---

## Agent 5 — Random.org Signed API

> ⚠️ **LIMITATION DE LA RECHERCHE** : L'agent n'a pas pu ouvrir les URLs officielles (WebFetch/curl/context7 tous refusés dans le sandbox). Les détails ci-dessous viennent de la mémoire d'entraînement et **doivent être revérifiés contre la doc officielle avant prod**.

### Endpoint

- URL : `https://api.random.org/json-rpc/v4/invoke`
- Méthode : `POST application/json`, enveloppe JSON-RPC 2.0
- Méthode métier : `generateSignedIntegers`

### Body type attendu

```json
{
  "jsonrpc": "2.0",
  "method": "generateSignedIntegers",
  "params": {
    "apiKey": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "n": 1,
    "min": 1,
    "max": 100,
    "replacement": true,
    "base": 10,
    "userData": { "roundId": "j_123", "nonce": "uuid" }
  },
  "id": 42
}
```

- `userData` : objet libre ≤ ~1 KB, **inclus dans la signature** — on y binde `roundId` + `nonce` pour prouver que ce tirage appartient bien à cette manche.
- Limites bornes : `n` ∈ [1, 10 000], `min/max` ∈ [-1e9, 1e9].

### Réponse

```json
{
  "result": {
    "random": {
      "method": "generateSignedIntegers",
      "hashedApiKey": "...",
      "data": [57],
      "userData": { "roundId": "j_123", "nonce": "uuid" },
      "completionTime": "2026-04-19 12:34:56Z",
      "serialNumber": 1234567
    },
    "signature": "BASE64_RSA_SIGNATURE==",
    "bitsLeft": 249993,
    "requestsLeft": 999,
    "advisoryDelay": 260
  }
}
```

⚠️ La **signature couvre l'objet `random` entier sérialisé** (pas juste `data`). Persister `random` **byte-pour-byte** tel que reçu, sinon la vérification casse.

### Latence / timeout / fallback

- Pas de SLA publié. Timeout HTTP **10 s**, 2 retries (500 ms / 2 s), puis **circuit breaker → fallback HMAC local** après 3 échecs consécutifs.
- Fallback = `crypto.randomInt` local + HMAC-SHA256 de `(serverSeed || clientSeed || nonce)`. On **persiste le tirage comme "fallback non signé"** dans la colonne `rng_source = 'hmac'`. Le user voit clairement qu'il n'y a pas de signature Random.org dans le panneau provably-fair.

### Vérification côté serveur (belt & braces)

- **Lib npm** : `@randomorg/core` (ou équivalent officiel — à confirmer sur npm au moment de l'install)
- **Fallback natif** : `crypto.createVerify('RSA-SHA512')` avec la clé publique PEM officielle stockée en env/secret
- À chaque réponse : **vérifier AVANT de persister**. Si KO → alert ops + fallback.

### Stockage DB (table `JackpotRound` ou table dédiée `JackpotRoundRng`)

```
random_json        String      // JSON exact de l'objet random (signature source)
signature          String      // base64
serial_number      BigInt
rng_source         Enum('random_org_signed', 'hmac_fallback')
verified_at        DateTime?
```

### Vérification côté user (UX provably-fair)

- Page publique `/fair/jackpot/{roundId}` qui affiche : `serialNumber`, `completionTime`, `userData.roundId`, `data`, `signature`, bouton **"Vérifier sur random.org"** (lien vers le form officiel `https://api.random.org/signatures/form` ou équivalent — à reconfirmer).
- Aussi : bouton "Copier le JSON" + exemple de commande `curl` pour vérifier offline.

### Quotas free tier (à reverifier sur `/api-keys`)

De mémoire : ~1 000 requêtes/jour ET ~250 000 bits/jour (premier plafond atteint bloque). Pour notre use-case (1 tirage par round, ~1 round toutes les 90 s max = ~960/jour en saturation), **le free tier est à la limite**. Recommandation : acheter un tier payant dès le lancement OU limiter à 1 round toutes les 2 min pour rester sous 720/jour.

Les champs `requestsLeft` / `bitsLeft` sont dans chaque réponse → logger dans `rdo_usage(day, requests_left, bits_left, checked_at)` pour alerting.

### Codes erreur JSON-RPC critiques

- `-32602` Invalid params → **pas de retry**, alert dev
- Erreurs apiKey invalide/suspended → **pas de retry**, alert ops, fallback immédiat
- Quota épuisé → basculer en fallback HMAC + email admin

### Pattern prod (inspirations CSGOLotto / PrimeDice / bustabit)

- Commit du hash serveur AVANT ouverture des paris (hash visible dans la page round)
- Révélation du seed + signature Random.org APRÈS clôture
- Route `/fair/{roundId}` publique, badge cliquable "Vérifié RANDOM.ORG"

---

## Recommandations consolidées pour l'étape 1

### Backend

- **Prisma** : nouvelle table `JackpotRound` (status, potTotal, serverSeedHash, serverSeed, clientSeed, nonce, randomJson, randomSignature, rngSource, winnerId, startedAt, endedAt) + `JackpotBet` (roundId, userId, amount, createdAt).
- **Service** `jackpotService.ts` : open/close/settle round, ticker timer 90 s, lock pendant RNG call, distribution (95 % winner, 5 % rake).
- **Client** `randomOrgClient.ts` : wrapper avec timeout 10 s, retry ×2, circuit breaker → fallback HMAC automatique si `RANDOM_ORG_API_KEY` absente OU si 3 fails consécutifs.
- **Routes** `/api/v1/jackpot/*` : `GET /current`, `POST /bet`, `GET /fair/:roundId`, `GET /history`.
- **Socket.io** room `jackpot:lobby` : events `pot:update`, `bet:new`, `round:closing`, `round:settled`, `wheel:spin`.

### Frontend

- Page `/jackpot` : wheel horizontale custom en framer-motion, timer circulaire SVG, liste participants avec %, count-up pot, confetti sur winner.
- Modal "Provably fair" : hash server seed (commit), client seed, nonce, JSON Random.org, signature, lien vérif officielle.
- Pas de feature flag (décision user).

### Variables d'env à prévoir

```
RANDOM_ORG_API_KEY=...           # facultative — si absente, fallback HMAC d'office
RANDOM_ORG_PUBLIC_KEY_PEM=...    # pour vérif locale avant persist (optionnel, lib peut la récupérer)
JACKPOT_MIN_BET=1
JACKPOT_MAX_BET=5000
JACKPOT_RAKE_PCT=0.05
JACKPOT_ROUND_DURATION_SEC=90
```

### Deps à ajouter

- Backend : `@randomorg/core` (à confirmer nom exact sur npm au moment de l'install)
- Frontend : `canvas-confetti` + `@types/canvas-confetti`

### Deps déjà présentes (à réutiliser)

- `framer-motion` (frontend)
- `socket.io` / `socket.io-client`
- `otplib` (pour 2FA sur gros gains optionnellement)

---

## Limites / points à reverifier avant étape 1

1. **Agent 5 n'a pas pu ouvrir la doc Random.org** (sandbox sans web). Avant de coder `randomOrgClient.ts`, relancer une session avec WebFetch autorisé sur `api.random.org/*` et vérifier :
   - URL exacte du JSON-RPC v4
   - Nom exact du package npm officiel
   - Quotas free tier réels en avril 2026
   - URL exacte du formulaire de vérif signature
2. **Usage total attendu** : ~960 rounds/jour en saturation — free tier insuffisant. Décider avant lancement : payer Random.org OU limiter la fréquence à 1 round toutes les 2 min.
3. **Fallback rate** : monitorer en prod le ratio HMAC vs Random.org signé. Si > 5 %, alerter.

---

## Prochaine étape (attente validation user)

Si OK :
- **Étape 1a** : backend Prisma + service + routes + socket, mode fallback HMAC par défaut (key absente).
- **Étape 1b** : une fois la `RANDOM_ORG_API_KEY` fournie par le user, activer le mode signé + tester la vérif de signature.
- **Étape 2** : frontend page `/jackpot` + modal provably-fair.
- **Étape 3** : validation live sur Railway, rapport `JACKPOT_LIVE_VALIDATION_2026-04-21.md`.

Pas d'écriture de code tant que le user n'a pas validé ce document.
