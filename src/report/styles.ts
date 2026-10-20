// src/report/styles.ts
export const STYLES = `
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
