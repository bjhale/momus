// src/report/template.ts
import type { ComparisonRecord } from "../types";
import { summarize, itemClass } from "./summary";

function b64(bytes?: Uint8Array): string {
  if (!bytes) return "";
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** One comparison as a collapsed accordion. */
function item(r: ComparisonRecord): string {
  const cls = itemClass(r);
  if (r.status === "error") {
    return `<details class="item ${cls}">
  <summary><span class="badge err">ERROR</span> <span class="path">${esc(r.path)}</span> <span class="vp">@${r.viewport}</span></summary>
  <div class="msg">${esc(r.error ?? "unknown error")}</div>
</details>`;
  }
  const badge = r.passed ? `<span class="badge pass">PASS</span>` : `<span class="badge fail">FAIL</span>`;
  const pct = ((r.diffScore ?? 0) * 100).toFixed(2);
  return `<details class="item ${cls}">
  <summary>${badge} <span class="path">${esc(r.path)}</span> <span class="vp">@${r.viewport}</span> <span class="score">${pct}%</span></summary>
  <div class="triptych">
    <figure><figcaption>dev</figcaption><img src="${b64(r.devImage)}" alt="dev"></figure>
    <figure><figcaption>prod</figcaption><img src="${b64(r.prodImage)}" alt="prod"></figure>
    <figure><figcaption>diff</figcaption><img src="${b64(r.diffImage)}" alt="diff"></figure>
  </div>
</details>`;
}

export function renderReport(
  records: ComparisonRecord[],
  meta: { dev: string; prod: string },
): string {
  // Worst-first: errors, then highest diffScore.
  const sorted = [...records].sort((a, b) => {
    const as = a.status === "error" ? Infinity : (a.diffScore ?? 0);
    const bs = b.status === "error" ? Infinity : (b.diffScore ?? 0);
    return bs - as;
  });
  const s = summarize(records);
  const items = sorted.map(item).join("\n");
  const worst = s.worst
    ? `worst: ${esc(s.worst.path)} @${s.worst.viewport} (${s.worst.pct}%)`
    : "worst: n/a";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>momus report</title>
<style>${STYLES}</style></head><body>
<header class="${s.verdict}">
  <div class="verdict">momus — ${s.verdict}</div>
  <div class="urls">${esc(meta.dev)} vs ${esc(meta.prod)}</div>
  <div class="counts">${s.total} comparisons · ${s.passed} passed · ${s.failed} failed · ${s.errored} errored</div>
  <div class="extras">${worst} · viewports: ${s.viewports.join(", ")}</div>
  <div class="filter">
    <button data-filter="all" class="active">All</button>
    <button data-filter="passed">Passed</button>
    <button data-filter="failed">Failed</button>
  </div>
</header>
<main data-filter="all">${items}</main>
<script>${SCRIPT}</script>
</body></html>`;
}

const STYLES = `
  body { font: 14px system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
  header { padding: 1rem 1.5rem; background: #000; position: sticky; top: 0; z-index: 1; border-bottom: 2px solid #333; }
  header .verdict { font-size: 1.25rem; font-weight: 700; }
  header.PASS .verdict { color: #3fb950; }
  header.FAIL .verdict { color: #f85149; }
  header .urls, header .counts, header .extras { color: #9aa0a6; margin-top: .25rem; }
  .filter { margin-top: .6rem; display: inline-flex; border: 1px solid #444; border-radius: .35rem; overflow: hidden; }
  .filter button { background: #1b1b1b; color: #ccc; border: 0; padding: .3rem .8rem; cursor: pointer; font: inherit; }
  .filter button + button { border-left: 1px solid #444; }
  .filter button.active { background: #2d6cdf; color: #fff; }
  .item { border-bottom: 1px solid #333; }
  .item > summary { cursor: pointer; padding: .7rem 1.5rem; display: flex; align-items: center; gap: .6rem; }
  .item .path { font-weight: 600; }
  .item .vp { color: #888; }
  .item .score { color: #aaa; margin-left: auto; }
  .badge { padding: .1rem .45rem; border-radius: .25rem; font-size: .72rem; font-weight: 700; }
  .badge.pass { background: #164; color: #cffcd8; }
  .badge.fail { background: #a22; color: #ffd9d9; }
  .badge.err { background: #9a6a12; color: #ffe9c2; }
  .triptych { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: .5rem; padding: 0 1.5rem 1rem; }
  figure { margin: 0; }
  figcaption { color: #888; font-size: .75rem; margin-bottom: .25rem; }
  img { max-width: 100%; border: 1px solid #444; background: #fff; }
  .msg { color: #f99; padding: 0 1.5rem 1rem; }
  main[data-filter="passed"] .item:not(.pass) { display: none; }
  main[data-filter="failed"] .item.pass { display: none; }
`;

const SCRIPT = `
  var main = document.querySelector('main');
  var btns = document.querySelectorAll('.filter button');
  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      main.dataset.filter = b.dataset.filter;
      btns.forEach(function (x) { x.classList.toggle('active', x === b); });
    });
  });
`;
