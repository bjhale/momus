// src/report/template.ts
import type { ComparisonRecord, Region } from "../types";
import { summarize, itemClass, dimensionNote } from "./summary";
import { STRICT_GATE, type GateOptions } from "../pipeline/verdict";
import { embedImages, type ImageRef, type ImageSide, type ImageSource } from "./images";
import { STYLES } from "./styles";
import { CLIENT_SCRIPT } from "./client";

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

/** `width`/`height` are the capture's own size, so 1:1 is exact even while a
 * thumbnail is showing. `--fw` is a narrower side's share of the padded width,
 * so dev and prod stay registered when the overlay modes stack them. */
function figure(images: ImageSource, r: ComparisonRecord, side: ImageSide, w?: number, h?: number, single = false): string {
  const ref = images(r, side);
  // In a viewer, 1:1 swaps the original in; a lone image has no viewer, so it links it.
  const full = ref?.full && !single ? ` data-full="${esc(ref.full)}"` : "";
  const size = w && h ? ` width="${w}" height="${h}"` : "";
  const fw = r.width && w && w !== r.width ? ` style="--fw:${(w / r.width).toFixed(4)}"` : "";
  const img = `<img src="${esc(ref?.src ?? "")}"${full} alt="${side}"${size} loading="lazy" decoding="async">`;
  return `<figure data-side="${side}"><figcaption>${side}</figcaption><div class="frame"${fw}>` +
    (single ? linkFull(img, ref) : img) +
    `${boxes(r.regions, w, h, "box")}${boxes(r.unstableRegions, w, h, "box unstable")}</div></figure>`;
}

/** Thumbnails mode: the preview opens the original. */
function linkFull(img: string, ref: ImageRef | undefined): string {
  return ref?.full ? `<a href="${esc(ref.full)}" target="_blank" rel="noopener">${img}</a>` : img;
}

const MODES = [["side", "Side by side"], ["slider", "Slider"], ["onion", "Onion skin"], ["highlight", "Highlight"]] as const;

/** The mode toolbar is per item, but the mode itself is global: the client
 * script keeps every toolbar in step with <main data-mode>. */
function viewer(r: ComparisonRecord, figures: string): string {
  const modes = MODES.map(([m, label]) =>
    `<button type="button" data-mode="${m}" aria-pressed="${m === "side"}">${label}</button>`).join("");
  const sw = r.width ? ` style="--sw:${r.width}px"` : "";
  return `<div class="viewer" style="--mix:50">
    <div class="modes" role="toolbar" aria-label="Comparison mode">${modes}` +
    `<span class="mix-l">dev</span><input type="range" class="mix" min="0" max="100" value="50" aria-label="dev to prod"><span class="mix-r">prod</span>` +
    `<button type="button" data-action="zoom" aria-pressed="false">1:1</button></div>
    <div class="stage"><div class="triptych"${sw}>${figures}</div></div>
  </div>`;
}

/** What the client script filters, groups and ranks by. */
function opening(r: ComparisonRecord): string {
  const cls = itemClass(r);
  return `<details class="item ${cls}" data-status="${cls}" data-source="${esc(r.source ?? "pages")}" ` +
    `data-viewport="${r.viewport}" data-target="${esc(r.targetId ?? r.path)}" data-label="${name(r)}" data-rank="${rank(r)}">`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One comparison as a collapsed accordion. */
function item(r: ComparisonRecord, images: ImageSource): string {
  if (r.status === "error") {
    // A one-sided failure still shows the side that rendered (RFC-0006).
    const sides = [
      r.devImage ? figure(images, r, "dev", r.devWidth, r.devHeight, true) : "",
      r.prodImage ? figure(images, r, "prod", r.prodWidth, r.prodHeight, true) : "",
    ].join("");
    return `${opening(r)}
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
      ? `<figure><figcaption>${caption}</figcaption>${linkFull(`<img src="${esc(img.src)}" alt="${r.status}">`, img)}</figure>`
      : `<div class="msg">${esc(r.error ?? "no image captured")}</div>`;
    return `${opening(r)}
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
  return `${opening(r)}
  <summary>${badge} <span class="path">${name(r)}</span>${vp(r)}${regions}${retries} <span class="score">${score}%</span></summary>${notes}
  ${viewer(r, figure(images, r, "dev", r.devWidth, r.devHeight) +
    figure(images, r, "prod", r.prodWidth, r.prodHeight) + figure(images, r, "diff", r.width, r.height))}
</details>`;
}

/** Worst-first ordering: errors, then added/removed/unstable (unreviewed
 * changes, above any diff score, which is at most 1), then highest diffScore. */
function rank(r: ComparisonRecord): number {
  if (r.status === "error") return Infinity;
  if (r.status === "added" || r.status === "removed" || r.status === "unstable") return 2;
  return r.diffScore ?? 0;
}

/** Triage order: what most needs a look first. */
const STATUSES = [["fail", "Failed"], ["error", "Errored"], ["added", "Added"], ["removed", "Removed"],
  ["unstable", "Unstable"], ["pass", "Passed"]] as const;

/** A select only when there is something to choose between. */
function select(key: string, all: string, values: string[]): string {
  if (values.length < 2) return "";
  return `<select data-filter="${key}"><option value="">${all}</option>` +
    values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("") + "</select>";
}

function filters(records: ComparisonRecord[], viewports: number[]): string {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(itemClass(r), (counts.get(itemClass(r)) ?? 0) + 1);
  const chips = STATUSES.filter(([st]) => counts.has(st)).map(([st, label]) =>
    `<button type="button" data-status="${st}" aria-pressed="true">${label} <span class="n">${counts.get(st)}</span></button>`).join("");
  const sources = [...new Set(records.map((r) => r.source ?? "pages"))].sort();
  return `<nav class="filters" aria-label="Filters">
    <span class="statuses">${chips}</span>
    ${select("source", "All sources", sources)}${select("viewport", "All viewports", viewports.map(String))}
    <input type="search" data-filter="path" placeholder="Filter by name ( / )" aria-label="Filter by name">
    <button type="button" data-action="group" aria-pressed="false">Group by target</button>
    <span class="shown"></span>
  </nav>
  <div class="keys">j / k next / previous · 1–4 or m mode · z 1:1 · g group · / search</div>`;
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
  ${filters(records, s.viewports)}
</header>
<main data-mode="side">${items}</main>
<script>${CLIENT_SCRIPT}</script>
</body></html>`;
}
