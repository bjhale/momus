// src/report/template.ts
import type { ComparisonRecord, Region } from "../types";
import { summarize, itemClass, dimensionNote } from "./summary";
import { STRICT_GATE, type GateOptions } from "../pipeline/verdict";
import { embedImages, type ImageSide, type ImageSource } from "./images";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function name(r: ComparisonRecord): string {
  return esc(r.label ?? r.path);
}

/** Source-level error rows carry viewport 0: they belong to no width. */
function vp(r: ComparisonRecord): string {
  return r.viewport > 0 ? ` <span class="vp">@${r.viewport}</span>` : "";
}

const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(3)}%`;

/** Outlines over an image, as percentages of that image's own size, so they
 * track it however the page scales it. Every image shares one frame (padding
 * is only right and bottom), so one region list serves all three. No size, no
 * outlines: a pre-v5 row knows only the diff's. */
function boxes(regions: Region[] | undefined, w: number | undefined, h: number | undefined, cls: string): string {
  if (!regions?.length || !w || !h) return "";
  return regions.map((g) =>
    `<div class="${cls}" style="left:${pct(g.x, w)};top:${pct(g.y, h)};width:${pct(g.width, w)};height:${pct(g.height, h)}"></div>`).join("");
}

function figure(images: ImageSource, r: ComparisonRecord, side: ImageSide, w?: number, h?: number): string {
  return `<figure><figcaption>${side}</figcaption><div class="frame"><img src="${esc(images(r, side)?.src ?? "")}" alt="${side}">` +
    `${boxes(r.regions, w, h, "box")}${boxes(r.unstableRegions, w, h, "box unstable")}</div></figure>`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One comparison as a collapsed accordion. */
function item(r: ComparisonRecord, images: ImageSource): string {
  const cls = itemClass(r);
  if (r.status === "error") {
    // A one-sided failure still shows the side that rendered (RFC-0006).
    const sides = [
      r.devImage ? figure(images, r, "dev", r.devWidth, r.devHeight) : "",
      r.prodImage ? figure(images, r, "prod", r.prodWidth, r.prodHeight) : "",
    ].join("");
    return `<details class="item ${cls}">
  <summary><span class="badge err">ERROR</span> <span class="path">${name(r)}</span>${vp(r)}</summary>
  <div class="msg">${esc(r.error ?? "unknown error")}</div>${sides ? `\n  <div class="single">${sides}</div>` : ""}
</details>`;
  }
  if (r.status === "added" || r.status === "removed") {
    // Only one side exists, so there is nothing to diff: show that side alone.
    const [badge, caption, img] = r.status === "added"
      ? [`<span class="badge new">ADDED</span>`, "dev (not in the baseline)", images(r, "dev")]
      : [`<span class="badge gone">REMOVED</span>`, "baseline (no longer listed)", images(r, "prod")];
    const body = img
      ? `<figure><figcaption>${caption}</figcaption><img src="${esc(img.src)}" alt="${r.status}"></figure>`
      : `<div class="msg">${esc(r.error ?? "no image captured")}</div>`;
    return `<details class="item ${cls}">
  <summary>${badge} <span class="path">${name(r)}</span>${vp(r)}</summary>
  <div class="single">${body}</div>
</details>`;
  }
  const badge = r.status === "unstable" ? `<span class="badge unstable">UNSTABLE</span>`
    : r.passed ? `<span class="badge pass">PASS</span>` : `<span class="badge fail">FAIL</span>`;
  const score = ((r.diffScore ?? 0) * 100).toFixed(2);
  const regions = r.regionCount ? ` <span class="regions">${plural(r.regionCount, "region", "regions")}</span>` : "";
  const retries = r.retries ? ` <span class="retries">${plural(r.retries, "retry", "retries")}</span>` : "";
  const dims = dimensionNote(r);
  const notes = [
    dims ? `${esc(dims)}. The magenta band is where only one side has pixels.` : "",
    r.status === "unstable"
      ? "prod rendered differently across two baseline captures (dashed outlines), so this diff doesn't count. " +
        "Mask what moves with stabilize.mask, then re-capture the baseline."
      : "",
  ].filter(Boolean).map((n) => `\n  <div class="note">${n}</div>`).join("");
  return `<details class="item ${cls}">
  <summary>${badge} <span class="path">${name(r)}</span>${vp(r)}${regions}${retries} <span class="score">${score}%</span></summary>${notes}
  <div class="triptych">
    ${figure(images, r, "dev", r.devWidth, r.devHeight)}
    ${figure(images, r, "prod", r.prodWidth, r.prodHeight)}
    ${figure(images, r, "diff", r.width, r.height)}
  </div>
</details>`;
}

/** Worst-first ordering: errors, then added/removed/unstable (unreviewed
 * changes, above any diff score, which is at most 1), then highest diffScore. */
function rank(r: ComparisonRecord): number {
  if (r.status === "error") return Infinity;
  if (r.status === "added" || r.status === "removed" || r.status === "unstable") return 2;
  return r.diffScore ?? 0;
}

/** Only shown when present, so a pages-only report reads exactly as before. */
function changes(s: { added: number; removed: number; unstable: number }): string {
  return (s.added ? ` · ${s.added} added` : "") + (s.removed ? ` · ${s.removed} removed` : "") +
    (s.unstable ? ` · ${s.unstable} unstable` : "");
}

export function renderReport(
  records: ComparisonRecord[],
  meta: { dev: string; prod: string; runId?: number; startedAt?: string; status?: string },
  gate: GateOptions = STRICT_GATE,
  opts: { images?: ImageSource } = {},
): string {
  const images = opts.images ?? embedImages;
  const sorted = [...records].sort((a, b) => rank(b) - rank(a));
  const s = summarize(records, gate);
  // A run that never completed (failed before comparing, or killed) has rows
  // that are missing or partial; "all passed" would be a lie. No status means
  // an in-memory render of rows the caller just produced.
  const incomplete = meta.status !== undefined && meta.status !== "complete";
  if (incomplete) s.verdict = "FAIL";
  const statusLabel = meta.status === "running" ? "incomplete" : meta.status;
  const items = sorted.map((r) => item(r, images)).join("\n");
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
  ${meta.runId !== undefined ? `<div class="run">run #${meta.runId}${meta.startedAt ? ` · ${esc(meta.startedAt)}` : ""}${incomplete ? ` · ${esc(statusLabel ?? "")}` : ""}</div>` : ""}
  <div class="counts">${s.total} comparisons · ${s.passed} passed · ${s.failed} failed · ${s.errored} errored${changes(s)}</div>
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
  header .urls, header .run, header .counts, header .extras { color: #9aa0a6; margin-top: .25rem; }
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
  .badge.new { background: #1f4f8a; color: #d6e8ff; }
  .badge.gone { background: #555; color: #eee; }
  .badge.unstable { background: #5a3e8c; color: #eadcff; }
  .item .regions, .item .retries { color: #aaa; font-size: .8rem; }
  .note { color: #d8b4fe; padding: 0 1.5rem .5rem; }
  .triptych { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: .5rem; padding: 0 1.5rem 1rem; }
  .single { padding: 0 1.5rem 1rem; }
  .single figure { max-width: 40rem; }
  figure { margin: 0; }
  figcaption { color: #888; font-size: .75rem; margin-bottom: .25rem; }
  .frame { position: relative; display: inline-block; max-width: 100%; border: 1px solid #444; background: #fff; vertical-align: top; }
  .frame img { display: block; max-width: 100%; }
  .box { position: absolute; outline: 2px solid #ffd400; pointer-events: none; }
  .box.unstable { outline: 2px dashed #3cf; }
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
