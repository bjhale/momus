// src/discovery/fetcher.ts
import type { Fetcher } from "./sitemap";

/** Build the real HTTP fetcher used for discovery. When `insecure`, invalid or
 * self-signed TLS certificates are accepted (Bun's per-request
 * `tls.rejectUnauthorized: false`). `headers` are extra HTTP headers sent on
 * every request (e.g. Cloudflare Access service token). `fetchImpl` is
 * injectable for tests. */
export function makeFetcher(
  insecure: boolean,
  headers?: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Fetcher {
  return async (url: string) => {
    const opts: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {};
    if (insecure) opts.tls = { rejectUnauthorized: false };
    if (headers && Object.keys(headers).length > 0) opts.headers = headers;
    const r = await fetchImpl(url, Object.keys(opts).length > 0 ? opts : undefined);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };
}
