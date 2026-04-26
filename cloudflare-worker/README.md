# AgeOfMoney Liquipedia Proxy (Cloudflare Worker)

Forwards Liquipedia HTTP requests through Cloudflare's edge so the outbound
IP comes from CF's network instead of Railway's egress pool. Bypasses the
rate-limit / WAF block on Railway's IP without paying for a residential
proxy. Free tier : 100 000 requests / day, ~70 req/min steady state — way
more than the scorer ever uses.

## How the URL rewrite works

```
Backend                                       Worker                          Liquipedia
GET https://aom-lp-proxy.<acc>.workers.dev/lp/ageofempires/api.php?action=parse...
                ↓ (with X-Proxy-Auth: <secret>)
                Worker validates auth + rewrites URL
                ↓
                                              GET https://liquipedia.net/ageofempires/api.php?action=parse...
                ↓
Backend receives the LP response untouched.
```

Backend code constructs the proxy URL via `lpProxyUrl()` in
`backend/src/services/liquipediaLiveScorer.ts`. When `LP_PROXY_URL` env
var is unset, every helper transparently falls back to direct LP access —
so deploying the worker is opt-in.

## Deploy steps (one-time, ~10 min)

1. **Create a free Cloudflare account** at https://dash.cloudflare.com (no
   credit card needed for the Workers free plan).

2. **Install wrangler** locally :
   ```bash
   npm install -g wrangler
   ```
   or use `npx wrangler` for one-shot.

3. **Login to Cloudflare** :
   ```bash
   cd cloudflare-worker
   wrangler login
   ```
   Browser opens, click Allow.

4. **Set the shared secret** (a random string ≥ 32 chars — generate one
   with `openssl rand -hex 32` or any password manager) :
   ```bash
   wrangler secret put PROXY_SECRET
   # paste secret when prompted
   ```

5. **Deploy** :
   ```bash
   wrangler deploy
   ```
   Output gives you the Worker URL, e.g.
   `https://aom-lp-proxy.<your-account>.workers.dev`.

6. **Set the matching env vars on Railway** (backend service → Variables) :
   - `LP_PROXY_URL` = the Worker URL from step 5 (no trailing slash)
   - `LP_PROXY_AUTH` = the same secret from step 4

   Railway redeploys the backend automatically.

7. **Verify** in Railway logs after redeploy. Look for :
   ```
   [LPScorer] LP proxy mode active — routing requests via https://aom-lp-proxy...
   ```
   Subsequent `[LPScorer] Match X: parsed N match blocks` should appear
   without 429s.

## Health check

From a shell with the secret :
```bash
curl -H "X-Proxy-Auth: <secret>" https://aom-lp-proxy.<acc>.workers.dev/healthz
# expects: ok
```

Without the header :
```bash
curl https://aom-lp-proxy.<acc>.workers.dev/healthz
# expects: 403 Forbidden
```

## Operational notes

- Free plan : 100 000 req/day. Current scorer max ≈ 70 req/min × 60 min × 24 h
  = 100 800. We're at the edge of the limit — if we ever scale up, upgrade to
  Workers Paid ($5/mo, 10M req/day).
- Cloudflare bills `subrequests` separately. Each Worker invocation makes 1
  fetch to LP = 1 subrequest. 50/req/sec subrequest limit per invocation —
  not a concern here.
- If LP rate-limits the Worker IP itself (unlikely — it's a CF IP), the
  same fallback / circuit breaker logic still applies on the backend side.

## Rotating the secret

```bash
wrangler secret put PROXY_SECRET   # paste new value
# Then update Railway env var LP_PROXY_AUTH to the new value
```
The previous secret is invalidated as soon as the new one is uploaded — no
race window because Workers reads `env.PROXY_SECRET` fresh on each request.
