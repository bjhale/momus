// src/report/styles.ts

/** The report's stylesheet. Comparison modes are layouts of the same three
 * figures, keyed on <main data-mode>; the script only flips attributes. */
export const STYLES = `
  body { font: 14px system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
  header { padding: 1rem 1.5rem; background: #000; position: sticky; top: 0; z-index: 1; border-bottom: 2px solid #333; }
  header .verdict { font-size: 1.25rem; font-weight: 700; }
  header.PASS .verdict { color: #3fb950; }
  header.FAIL .verdict { color: #f85149; }
  header .urls, header .run, header .counts, header .extras { color: #9aa0a6; margin-top: .25rem; }
  .filters { margin-top: .6rem; display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; }
  .statuses { display: inline-flex; flex-wrap: wrap; gap: .3rem; }
  .filters button, .filters select, .filters input, .modes button {
    background: #1b1b1b; color: #ccc; border: 1px solid #444; border-radius: .35rem;
    padding: .25rem .65rem; font: inherit; cursor: pointer; }
  .filters input[type="search"] { cursor: text; min-width: 14rem; }
  .filters [aria-pressed="true"], .modes [aria-pressed="true"] { background: #2d6cdf; border-color: #2d6cdf; color: #fff; }
  .filters .n { opacity: .75; font-size: .8em; }
  .shown, .keys { color: #888; font-size: .8rem; }
  .keys { margin-top: .35rem; }
  :focus-visible { outline: 2px solid #ffd400; outline-offset: 1px; }
  .item { border-bottom: 1px solid #333; scroll-margin-top: var(--hh, 0px); }
  .item[hidden], .group-head[hidden] { display: none; }
  .item > summary { cursor: pointer; padding: .7rem 1.5rem; display: flex; align-items: center; gap: .6rem; }
  .item .path { font-weight: 600; }
  .item .vp { color: #888; }
  .item .score { color: #aaa; margin-left: auto; }
  .group-head { margin: 0; padding: 1rem 1.5rem .35rem; font-size: .85rem; font-weight: 600; color: #9aa0a6; border-bottom: 1px solid #333; }
  .badge { padding: .1rem .45rem; border-radius: .25rem; font-size: .72rem; font-weight: 700; }
  .badge.pass { background: #164; color: #cffcd8; }
  .badge.fail { background: #a22; color: #ffd9d9; }
  .badge.err { background: #9a6a12; color: #ffe9c2; }
  .badge.new { background: #1f4f8a; color: #d6e8ff; }
  .badge.gone { background: #555; color: #eee; }
  .badge.unstable { background: #5a3e8c; color: #eadcff; }
  .item .regions, .item .retries { color: #aaa; font-size: .8rem; }
  .note { color: #d8b4fe; padding: 0 1.5rem .5rem; }
  .viewer { padding: 0 1.5rem 1rem; }
  .modes { display: flex; flex-wrap: wrap; gap: .35rem; align-items: center; margin-bottom: .5rem; }
  .modes .mix-l, .modes .mix-r { color: #888; font-size: .75rem; }
  .modes .mix, .modes .mix-l, .modes .mix-r { display: none; }
  main[data-mode="slider"] .modes .mix, main[data-mode="slider"] .modes .mix-l, main[data-mode="slider"] .modes .mix-r,
  main[data-mode="onion"] .modes .mix, main[data-mode="onion"] .modes .mix-l, main[data-mode="onion"] .modes .mix-r { display: inline-block; }
  .modes [data-action="zoom"] { margin-left: auto; }
  .triptych { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: .5rem; position: relative; }
  .single { padding: 0 1.5rem 1rem; }
  .single figure { max-width: 40rem; }
  figure { margin: 0; }
  figcaption { color: #888; font-size: .75rem; margin-bottom: .25rem; }
  .frame { position: relative; display: inline-block; max-width: 100%; border: 1px solid #444; background: #fff; vertical-align: top; }
  .frame img { display: block; max-width: 100%; height: auto; -webkit-user-drag: none; user-select: none; }
  .box { position: absolute; outline: 2px solid #ffd400; pointer-events: none; }
  .box.unstable { outline: 2px dashed #3cf; }
  .msg { color: #f99; padding: 0 1.5rem 1rem; }

  /* Slider and onion skin: dev and prod in one grid cell, prod on top. */
  main[data-mode="slider"] .triptych, main[data-mode="onion"] .triptych,
  main[data-mode="highlight"] .triptych { grid-template-columns: 1fr; max-width: var(--sw, 100%); }
  main[data-mode="slider"] figure, main[data-mode="onion"] figure { grid-area: 1 / 1; }
  main[data-mode="slider"] figcaption, main[data-mode="onion"] figcaption { display: none; }
  main[data-mode="slider"] [data-side="diff"], main[data-mode="onion"] [data-side="diff"],
  main[data-mode="highlight"] [data-side="prod"], main[data-mode="highlight"] [data-side="diff"] { display: none; }
  main[data-mode="slider"] .frame, main[data-mode="onion"] .frame,
  main[data-mode="highlight"] .frame { display: block; width: calc(var(--fw, 1) * 100%); }
  main[data-mode="slider"] .viewer:not(.zoom) .frame img, main[data-mode="onion"] .viewer:not(.zoom) .frame img,
  main[data-mode="highlight"] .viewer:not(.zoom) .frame img { width: 100%; }
  main[data-mode="slider"] [data-side="prod"] { clip-path: inset(0 0 0 calc(var(--mix) * 1%)); }
  main[data-mode="slider"] .triptych::after {
    content: ""; position: absolute; top: 0; bottom: 0; left: calc(var(--mix) * 1%); width: 2px;
    background: #ffd400; pointer-events: none; }
  main[data-mode="slider"] .stage { cursor: ew-resize; touch-action: none; }
  main[data-mode="onion"] [data-side="prod"] { opacity: calc(var(--mix) / 100); }
  main[data-mode="highlight"] .box { outline-width: 3px; background: rgba(255, 212, 0, .12); }

  /* 1:1: every image at its capture size (its width attribute), in a stage
     that scrolls; drag pans. */
  .viewer.zoom .stage { overflow: auto; max-height: 80vh; cursor: grab; touch-action: none; }
  main[data-mode="slider"] .viewer.zoom .stage { cursor: ew-resize; }
  .viewer.zoom .triptych { grid-template-columns: repeat(3, max-content); max-width: none; }
  main:not([data-mode="side"]) .viewer.zoom .triptych { grid-template-columns: max-content; }
  .viewer.zoom .frame { width: auto; max-width: none; }
  .viewer.zoom .frame img { max-width: none; }
`;
