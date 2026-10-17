// tests/capture/steps.integration.test.ts
import { test, expect } from "bun:test";
import { launchBrowser } from "../../src/capture/browser";
import { runSteps, StepError } from "../../src/capture/steps";
import { launchable, TEST_ENGINES } from "../helpers/engines";

// Each control records what happened to it on window.log, so one page can
// verify every step kind.
const PAGE = `<html><body style="height:3000px">
  <button id="b" onclick="log.push('click')">b</button>
  <a id="h" onmouseenter="log.push('hover')">h</a>
  <input id="i" onkeydown="if(event.key==='Enter')log.push('enter:'+this.value)">
  <select id="s" onchange="log.push('select:'+this.value)"><option>a</option><option>b</option></select>
  <div id="late" hidden>late</div><div id="gone">gone</div>
  <footer id="f" style="margin-top:2500px">f</footer>
  <script>
    window.log = [];
    document.addEventListener('keydown', e => { if (e.key === 'Escape') log.push('escape'); });
    setTimeout(() => { document.getElementById('late').hidden = false; document.getElementById('gone').remove(); }, 100);
  </script></body></html>`;

for (const engine of TEST_ENGINES) {
  const maybe = (await launchable(engine)) ? test : test.skip;

  maybe(`[${engine}] runs every step kind in order`, async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response(PAGE, { headers: { "content-type": "text/html" } }) });
    const browser = await launchBrowser(engine);
    try {
      const page = await browser.newPage();
      await runSteps(page, [
        { goto: "/" },
        { click: "#b" }, { hover: "#h" }, { fill: ["#i", "x"] }, { press: ["#i", "Enter"] },
        { press: "Escape" }, { select: ["#s", "b"] }, { scroll: "#f" },
        { waitFor: "#late" }, { waitFor: { hidden: "#gone" } }, { wait: 10 },
        { evaluate: "window.log.push('eval')" },
      ], { timeoutMs: 5000, baseUrl: `http://localhost:${server.port}` });
      expect(await page.evaluate(() => (window as any).log)).toEqual(
        ["click", "hover", "enter:x", "escape", "select:b", "eval"]);
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    } finally { await browser.close(); server.stop(); }
  });

  maybe(`[${engine}] a failing step throws StepError naming the 1-based step`, async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response(PAGE, { headers: { "content-type": "text/html" } }) });
    const browser = await launchBrowser(engine);
    try {
      const page = await browser.newPage();
      const err = await runSteps(page, [{ goto: "/" }, { click: "#missing" }],
        { timeoutMs: 300, baseUrl: `http://localhost:${server.port}` }).catch((e) => e);
      expect(err).toBeInstanceOf(StepError);
      expect(err.message).toStartWith('step 2: click "#missing": ');
      expect(err.message).not.toContain("\n");
    } finally { await browser.close(); server.stop(); }
  });

  maybe(`[${engine}] goto treats an HTTP error as a failure`, async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("no", { status: 500 }) });
    const browser = await launchBrowser(engine);
    try {
      const page = await browser.newPage();
      const err = await runSteps(page, [{ goto: "/login" }],
        { timeoutMs: 3000, baseUrl: `http://localhost:${server.port}` }).catch((e) => e);
      expect(err.message).toContain("step 1: goto \"/login\": HTTP 500");
    } finally { await browser.close(); server.stop(); }
  });
}
