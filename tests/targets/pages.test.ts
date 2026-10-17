// tests/targets/pages.test.ts
import { test, expect } from "bun:test";
import { pagesSource } from "../../src/targets/pages";
import { ConfigSchema } from "../../src/config/schema";

function cfg(discovery: Record<string, unknown> = {}) {
  return ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280], discovery });
}
const noDiscover = async (): Promise<string[]> => { throw new Error("must not discover"); };
const noRead = async (): Promise<string> => { throw new Error("must not read urlList"); };
const ref = (path: string) => ({ targetId: path, path });

test("listForSnapshot: discovered paths become page targets", async () => {
  const src = pagesSource({ config: cfg(), discover: async () => ["/", "/a"] });
  const ts = await src.listForSnapshot();
  expect(ts.map((t) => [t.id, t.source, t.url.dev, t.url.prod])).toEqual([
    ["/", "pages", "https://dev.example.com/", "https://www.example.com/"],
    ["/a", "pages", "https://dev.example.com/a", "https://www.example.com/a"],
  ]);
});

test("listLive without a urlList: exactly the baseline's paths, no discovery, no file read", async () => {
  const src = pagesSource({ config: cfg(), discover: noDiscover, readUrlList: noRead });
  const ts = await src.listLive([ref("/"), ref("/"), ref("/a")]); // one row per viewport → dedupe
  expect(ts.map((t) => t.id)).toEqual(["/", "/a"]);
});

test("listLive with a urlList: adds entries the baseline lacks, honoring exclude", async () => {
  const src = pagesSource({
    config: cfg({ urlList: "urls.txt", exclude: ["/admin/**"] }),
    discover: noDiscover,
    readUrlList: async () => "/\n/new\nhttps://www.example.com/also-new\n/admin/x\n",
  });
  const ts = await src.listLive([ref("/")]);
  expect(ts.map((t) => t.id)).toEqual(["/", "/new", "/also-new"]);
});

test("listLive: additions are capped so the total stays within maxPages", async () => {
  const read = async () => "/n1\n/n2\n/n3\n";
  const at = (maxPages: number) => pagesSource({ config: cfg({ urlList: "u", maxPages }), discover: noDiscover, readUrlList: read })
    .listLive([ref("/a"), ref("/b")]).then((ts) => ts.map((t) => t.id));
  expect(await at(2)).toEqual(["/a", "/b"]);              // baseline already at the cap
  expect(await at(3)).toEqual(["/a", "/b", "/n1"]);
  expect(await at(0)).toEqual(["/a", "/b", "/n1", "/n2", "/n3"]); // 0 = unlimited
});

test("listLive rejects when the urlList can't be read", async () => {
  const src = pagesSource({ config: cfg({ urlList: "missing.txt" }), discover: noDiscover,
    readUrlList: async () => { throw new Error("ENOENT: missing.txt"); } });
  await expect(src.listLive([ref("/")])).rejects.toThrow("ENOENT: missing.txt");
});
