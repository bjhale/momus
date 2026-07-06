// tests/capture/remove.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled, launchBrowser } from "../../src/capture/browser";
import { removeSelectors } from "../../src/capture/screenshot";

const maybe = isBrowserInstalled() ? test : test.skip;

maybe("removes matching elements from the DOM, keeps others", async () => {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<div class="remove-me">x</div><div class="keep">y</div>`);
    await removeSelectors(page, [".remove-me"]);
    expect(await page.$(".remove-me")).toBeNull();
    expect(await page.$(".keep")).not.toBeNull();
    await ctx.close();
  } finally {
    await browser.close();
  }
});

maybe("an invalid selector does not throw and leaves the DOM intact", async () => {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<div class="keep">y</div>`);
    await removeSelectors(page, ["::::"]); // invalid → skipped, not fatal
    expect(await page.$(".keep")).not.toBeNull();
    await ctx.close();
  } finally {
    await browser.close();
  }
});

maybe("empty selector list is a no-op", async () => {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<div class="keep">y</div>`);
    await removeSelectors(page, []);
    expect(await page.$(".keep")).not.toBeNull();
    await ctx.close();
  } finally {
    await browser.close();
  }
});

maybe("removes elements inside an open shadow root (e.g. Next.js dev indicator)", async () => {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Mirror Next.js: a <nextjs-portal> host with an open shadow root that
    // contains #devtools-indicator. document.querySelectorAll can't see it.
    await page.setContent(`<nextjs-portal></nextjs-portal><div class="light">keep</div>`);
    await page.evaluate(() => {
      const host = document.querySelector("nextjs-portal")!;
      host.attachShadow({ mode: "open" }).innerHTML = `<div id="devtools-indicator">N</div>`;
    });

    await removeSelectors(page, ["#devtools-indicator"]);

    const stillThere = await page.evaluate(() =>
      !!document.querySelector("nextjs-portal")?.shadowRoot?.querySelector("#devtools-indicator"));
    expect(stillThere).toBe(false);            // removed from the shadow root
    expect(await page.$(".light")).not.toBeNull(); // light DOM untouched
    await ctx.close();
  } finally {
    await browser.close();
  }
});
