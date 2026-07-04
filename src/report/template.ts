// src/report/template.ts
import type { ComparisonRecord } from "../types";

function b64(bytes?: Uint8Array): string {
  if (!bytes) return "";
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function card(r: ComparisonRecord): string {
  if (r.status === "error") {
    return `<section class="card error">
      <h2>${esc(r.path)} <span class="vp">@${r.viewport}</span> <span class="badge err">ERROR</span></h2>
      <p class="msg">${esc(r.error ?? "unknown error")}</p></section>`;
  }
  const verdict = r.passed ? `<span class="badge pass">PASS</span>` : `<span class="badge fail">FAIL</span>`;
  const pct = ((r.diffScore ?? 0) * 100).toFixed(2);
  return `<section class="card">
    <h2>${esc(r.path)} <span class="vp">@${r.viewport}</span> ${verdict}
      <span class="score">${pct}% changed</span></h2>
    <div class="triptych">
      <figure><figcaption>dev</figcaption><img src="${b64(r.devImage)}" alt="dev"></figure>
      <figure><figcaption>prod</figcaption><img src="${b64(r.prodImage)}" alt="prod"></figure>
      <figure><figcaption>diff</figcaption><img src="${b64(r.diffImage)}" alt="diff"></figure>
    </div></section>`;
}

export function renderReport(
  records: ComparisonRecord[],
  meta: { dev: string; prod: string },
): string {
  // Worst-first: errors and highest diffScore at the top.
  const sorted = [...records].sort((a, b) => {
    const as = a.status === "error" ? Infinity : (a.diffScore ?? 0);
    const bs = b.status === "error" ? Infinity : (b.diffScore ?? 0);
    return bs - as;
  });
  const cards = sorted.map(card).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>momus report</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
  header { padding: 1rem 1.5rem; background: #000; position: sticky; top: 0; }
  .card { padding: 1rem 1.5rem; border-bottom: 1px solid #333; }
  .triptych { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: .5rem; }
  figure { margin: 0; } img { max-width: 100%; border: 1px solid #444; background: #fff; }
  .badge { padding: .1rem .4rem; border-radius: .25rem; font-size: .75rem; }
  .pass { background: #164; } .fail { background: #a22; } .err { background: #953; }
  .vp { color: #888; } .score { color: #aaa; margin-left: .5rem; }
  .error .msg { color: #f99; }
</style></head><body>
<header><strong>momus</strong> — ${esc(meta.dev)} vs ${esc(meta.prod)} — ${sorted.length} comparisons</header>
<main>${cards}</main></body></html>`;
}
