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
