// src/discovery/fetcher.ts
import type { Fetcher } from "./sitemap";

/** Build the real HTTP fetcher used for discovery. When `insecure`, invalid or
 * self-signed TLS certificates are accepted (Bun's per-request
 * `tls.rejectUnauthorized: false`). `fetchImpl` is injectable for tests. */
export function makeFetcher(insecure: boolean, fetchImpl: typeof fetch = fetch): Fetcher {
  return async (url: string) => {
    const r = await fetchImpl(url, insecure ? { tls: { rejectUnauthorized: false } } : undefined);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };
}
