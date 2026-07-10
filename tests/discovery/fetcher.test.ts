// tests/discovery/fetcher.test.ts
import { test, expect } from "bun:test";
import { makeFetcher } from "../../src/discovery/fetcher";

test("passes tls rejectUnauthorized:false when insecure", async () => {
  let seenInit: any;
  const fake = (async (_url: string, init?: any) => {
    seenInit = init;
    return new Response("body", { status: 200 });
  }) as unknown as typeof fetch;

  const f = makeFetcher(true, undefined, fake);
  const r = await f("https://x.example");

  expect(seenInit?.tls?.rejectUnauthorized).toBe(false);
  expect(r.ok).toBe(true);
  expect(r.status).toBe(200);
  expect(await r.text()).toBe("body");
});

test("passes no init when secure", async () => {
  let seenInit: any = "sentinel";
  const fake = (async (_url: string, init?: any) => {
    seenInit = init;
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;

  const f = makeFetcher(false, undefined, fake);
  const r = await f("https://x.example");

  expect(seenInit).toBeUndefined();
  expect(r.ok).toBe(false);
  expect(r.status).toBe(404);
});

test("sends provided requestHeaders on every request", async () => {
  let seenInit: any;
  const fake = (async (_url: string, init?: any) => {
    seenInit = init;
    return new Response("body", { status: 200 });
  }) as unknown as typeof fetch;

  const headers = { "CF-Access-Client-Id": "abc", "CF-Access-Client-Secret": "xyz" };
  const f = makeFetcher(false, headers, fake);
  await f("https://x.example");

  expect(seenInit?.headers).toEqual(headers);
  expect(seenInit?.tls).toBeUndefined();
});

test("omits headers (init undefined) when headers is an empty object and secure", async () => {
  let seenInit: any = "sentinel";
  const fake = (async (_url: string, init?: any) => {
    seenInit = init;
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;

  const f = makeFetcher(false, {}, fake);
  await f("https://x.example");

  expect(seenInit).toBeUndefined();
});

test("combines tls and headers when both insecure and headers are set", async () => {
  let seenInit: any;
  const fake = (async (_url: string, init?: any) => {
    seenInit = init;
    return new Response("body", { status: 200 });
  }) as unknown as typeof fetch;

  const headers = { Authorization: "Bearer token" };
  const f = makeFetcher(true, headers, fake);
  await f("https://x.example");

  expect(seenInit?.tls?.rejectUnauthorized).toBe(false);
  expect(seenInit?.headers).toEqual(headers);
});
