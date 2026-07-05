// src/discovery/urllist.ts

/** Parse a newline-delimited URL/path list into paths for the discovery
 * pipeline. Each non-blank line becomes a path: a full URL (http/https) must be
 * under `prodBase` — else it throws — and is reduced to the part after the base;
 * a bare path is used as-is with a leading slash ensured. Fragments (`#...`) are
 * stripped; query strings are kept. Line order is preserved (dedup happens in
 * discoverPaths). */
export function parseUrlList(content: string, prodBase: string): string[] {
  const pb = prodBase.replace(/\/+$/, ""); // ignore trailing slash(es) on the base
  const out: string[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;

    let path: string;
    if (/^https?:\/\//i.test(line)) {
      // Full URL: must start with the prod base, and the next char must be a
      // path/query/fragment boundary (so "https://a.com" doesn't match
      // "https://a.com.evil/…").
      // Scheme + host are case-insensitive; compare case-folded but slice the
      // original line so the path keeps its case.
      const rest = line.toLowerCase().startsWith(pb.toLowerCase()) ? line.slice(pb.length) : null;
      if (rest === null || !(rest === "" || rest[0] === "/" || rest[0] === "?" || rest[0] === "#")) {
        throw new Error(`urlList entry not under prod base ${prodBase}: ${line}`);
      }
      path = rest === "" ? "/" : rest[0] === "/" ? rest : "/" + rest;
    } else {
      path = line[0] === "/" ? line : "/" + line;
    }

    const hash = path.indexOf("#");
    if (hash !== -1) path = path.slice(0, hash);
    if (path === "") path = "/";
    out.push(path);
  }

  return out;
}
