// tests/capture/setup.integration.test.ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { launchBrowser } from "../../src/capture/browser";
import { ConfigSchema } from "../../src/config/schema";
import { runSetup, SetupError } from "../../src/capture/setup";
import { launchable } from "../helpers/engines";

const canLaunch = await launchable("chromium");
const maybe = canLaunch ? test : test.skip;
// Shared per file: launching is the slow part, and isolation holds because every
// capture and setup opens its own browser context.
let browser: Awaited<ReturnType<typeof launchBrowser>>;
beforeAll(async () => { if (canLaunch) browser = await launchBrowser("chromium"); });
afterAll(async () => { await browser?.close(); });

const FORM = `<form method="post" action="/login"><input id="email" name="email">
  <input id="password" name="password" type="password"><button type="submit">go</button></form>`;

function loginSite() {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/login" && req.method === "POST") {
        const form = await req.formData();
        if (form.get("email") === "me@example.com" && form.get("password") === "hunter2") {
          return new Response(null, { status: 303, headers: { location: "/", "set-cookie": "session=ok; Path=/" } });
        }
        return new Response(FORM, { headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/login") return new Response(FORM, { headers: { "content-type": "text/html" } });
      const authed = (req.headers.get("cookie") ?? "").includes("session=ok");
      return new Response(`<html><body>${authed ? "<div data-user-menu>me</div>" : "anon"}</body></html>`,
        { headers: { "content-type": "text/html" } });
    },
  });
}

function configFor(origin: string, password: string) {
  return ConfigSchema.parse({
    dev: origin, prod: origin, viewports: [1280], stabilize: { timeoutMs: 1000 },
    setup: { steps: [
      { goto: "/login" }, { fill: ["#email", "me@example.com"] }, { fill: ["#password", password] },
      { click: "button[type=submit]" }, { waitFor: "[data-user-menu]" },
    ] },
  });
}

maybe("setup logs in and returns the session", async () => {
  const server = loginSite();
  try {
    const state = await runSetup(browser, "dev", configFor(`http://localhost:${server.port}`, "hunter2"));
    expect(state!.cookies.map((c) => c.name)).toContain("session");
  } finally { server.stop(); }
});

maybe("a failed login is a SetupError that does not leak the password", async () => {
  const server = loginSite();
  try {
    const err = await runSetup(browser, "dev", configFor(`http://localhost:${server.port}`, "wrong-pw-xyz")).catch((e) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect(err.message.startsWith('setup (dev) step 5: waitFor "[data-user-menu]": ')).toBe(true);
    expect(err.message).not.toContain("wrong-pw-xyz");
  } finally { server.stop(); }
});
