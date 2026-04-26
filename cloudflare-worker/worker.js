/**
 * AgeOfMoney Liquipedia proxy.
 *
 * Routes all LP scraper / scorer traffic through Cloudflare's edge so the
 * outbound IP comes from CF's own network instead of Railway's egress pool.
 * Bypasses the rate-limit / WAF block on Railway's IP without paying for a
 * residential proxy.
 *
 * URL format :
 *   https://<worker-host>/lp/<path>?<query>
 *     → fetches https://liquipedia.net/<path>?<query>
 *
 * Auth :
 *   Backend MUST send `X-Proxy-Auth: <secret>` matching env.PROXY_SECRET.
 *   No header → 403. Public Worker URL stays useless for anyone else.
 *
 * Cookies / referer / body :
 *   Forwarded transparently (the unblock POST flow needs both Cookie and
 *   Referer to round-trip).
 *
 * Free plan limits :
 *   100 000 requests / day, 10 ms CPU time / request — way more than the
 *   ~70 req/min the scorer ever generates.
 */

export default {
  async fetch(request, env) {
    // ── Auth ────────────────────────────────────────────────────────────
    const auth = request.headers.get('x-proxy-auth');
    if (!env.PROXY_SECRET || auth !== env.PROXY_SECRET) {
      return new Response('Forbidden', { status: 403 });
    }

    const url = new URL(request.url);

    // Health check : GET /healthz returns 200 OK plain text (no auth path
    // needed — but we already failed-closed above, so even health needs
    // auth to keep the worker URL undiscoverable from random scans).
    if (url.pathname === '/healthz') {
      return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    // ── Path → target LP URL ────────────────────────────────────────────
    if (!url.pathname.startsWith('/lp/')) {
      return new Response('Use /lp/<path>', { status: 400 });
    }
    const lpPath = url.pathname.slice('/lp'.length); // keeps leading slash
    const targetUrl = `https://liquipedia.net${lpPath}${url.search}`;

    // ── Forward request ─────────────────────────────────────────────────
    // Copy through only the headers LP cares about. Stripping CF-* and
    // x-proxy-auth avoids leaking infra details and bot signatures.
    const fwdHeaders = new Headers();
    const passthrough = ['user-agent', 'accept', 'accept-language', 'cookie', 'referer', 'content-type'];
    for (const h of passthrough) {
      const v = request.headers.get(h);
      if (v) fwdHeaders.set(h, v);
    }
    if (!fwdHeaders.has('user-agent')) {
      fwdHeaders.set('User-Agent', 'AgeOfMoney/1.0 (contact@ageofmoney.com)');
    }

    const init = {
      method: request.method,
      headers: fwdHeaders,
      // Don't auto-decode — pass body bytes through exactly. Required for
      // form-url-encoded POSTs on the unblock flow.
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      // Don't follow redirects automatically — the scorer sometimes uses
      // a 302 as the success signal.
      redirect: 'manual',
    };

    let lpResp;
    try {
      lpResp = await fetch(targetUrl, init);
    } catch (err) {
      return new Response(`Upstream fetch failed: ${err?.message ?? err}`, { status: 502 });
    }

    // ── Forward response back to backend ────────────────────────────────
    // Drop hop-by-hop and CF-* headers; keep set-cookie because the
    // unblock flow needs the session cookie LP sets on the GET.
    const respHeaders = new Headers();
    for (const [key, value] of lpResp.headers.entries()) {
      const lk = key.toLowerCase();
      if (lk.startsWith('cf-')) continue;
      if (lk === 'transfer-encoding' || lk === 'connection' || lk === 'keep-alive') continue;
      respHeaders.append(key, value);
    }

    return new Response(lpResp.body, {
      status: lpResp.status,
      headers: respHeaders,
    });
  },
};
