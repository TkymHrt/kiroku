import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vite-plus/test";
import { staticCacheHeaders } from "../build/static-cache";

const defaults = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");

describe("build-specific static cache allowlist", () => {
  it("retains private response defaults and all security protections", () => {
    const result = staticCacheHeaders(defaults, {}, new Set());
    expect(result).toContain("Cache-Control: no-store");
    expect(result).toContain("Pragma: no-cache");
    // Runtime header rules must leave the authenticated asset policy intact.
    expect(defaults).not.toContain("Cache-Control");
    expect(defaults).not.toContain("Pragma");
    for (const header of [
      "X-Content-Type-Options: nosniff",
      "Referrer-Policy: no-referrer",
      "X-Frame-Options: DENY",
      "Permissions-Policy: camera=(), microphone=(), geolocation=()",
      "Cross-Origin-Resource-Policy: same-origin",
      "Content-Security-Policy: default-src 'self'",
    ]) {
      expect(defaults).toContain(header);
      expect(result).toContain(header);
    }
  });

  it("caches only emitted hashed JS/CSS referenced by the client manifest", () => {
    const manifest = {
      entry: { file: "assets/index-AbCd1234.js", css: ["assets/index-EfGh5678.css"] },
      lazy: { file: "assets/editor-IjKl9012.js", css: ["assets/index-EfGh5678.css"] },
      absent: { file: "assets/missing-MnOp3456.js" },
      unhashed: { file: "assets/plain.js" },
      html: { file: "assets/page-QrSt7890.html" },
      unrelated: { file: "other/module-UvWx1234.js" },
    };
    const result = staticCacheHeaders(
      defaults,
      manifest,
      new Set([
        "assets/index-AbCd1234.js",
        "assets/index-EfGh5678.css",
        "assets/editor-IjKl9012.js",
        "assets/plain.js",
        "assets/page-QrSt7890.html",
        "other/module-UvWx1234.js",
        "assets/public-YzAb5678.js",
        "index.html",
      ]),
    );
    expect(result.startsWith(staticCacheHeaders(defaults, {}, new Set()))).toBe(true);
    expect(result.match(/private, max-age=31536000, immutable/g)).toHaveLength(3);
    expect(result.match(/! Cache-Control/g)).toHaveLength(3);
    expect(result.match(/! Pragma/g)).toHaveLength(3);
    expect(result).toContain("/assets/index-AbCd1234.js\n");
    expect(result).toContain("/assets/index-EfGh5678.css\n");
    expect(result).toContain("/assets/editor-IjKl9012.js\n");
    for (const excluded of ["missing-", "plain.js", "page-", "other/", "public-", "/index.html"]) {
      expect(result).not.toContain(excluded);
    }
  });

  it("applies exact private policies and inherited protections through the actual Assets binding", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kiroku-static-cache-"));
    const js = "assets/index-AbCd1234.js";
    const css = "assets/index-EfGh5678.css";
    await mkdir(join(directory, "assets"));
    await Promise.all([
      writeFile(
        join(directory, "index.html"),
        "<!doctype html><title>Static cache fixture</title>",
      ),
      writeFile(join(directory, js), "export const fixture=true;"),
      writeFile(join(directory, css), ".fixture{color:inherit}"),
      writeFile(join(directory, "assets/public-IjKl9012.js"), "export const publicFixture=true;"),
      writeFile(
        join(directory, "_headers"),
        staticCacheHeaders(defaults, { entry: { file: js, css: [css] } }, new Set([js, css])),
      ),
    ]);
    const runtime = new Miniflare({
      modules: true,
      compatibilityDate: "2026-02-24",
      script: "export default { fetch(request, env) { return env.ASSETS.fetch(request); } }",
      assets: {
        directory,
        binding: "ASSETS",
        routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true },
        assetConfig: { not_found_handling: "none" },
      },
    });
    try {
      for (const path of [js, css]) {
        const response = await runtime.dispatchFetch(`https://static-cache.test/${path}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
        expect(response.headers.get("pragma")).toBeNull();
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
        const etag = response.headers.get("etag")!;
        await response.arrayBuffer();
        const revalidated = await runtime.dispatchFetch(`https://static-cache.test/${path}`, {
          headers: { "If-None-Match": etag },
        });
        expect(revalidated.status).toBe(304);
        expect(revalidated.headers.get("cache-control")).toBe(
          "private, max-age=31536000, immutable",
        );
        expect(revalidated.headers.get("pragma")).toBeNull();
      }
      for (const path of ["/", "/assets/public-IjKl9012.js"]) {
        const response = await runtime.dispatchFetch(`https://static-cache.test${path}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("pragma")).toBe("no-cache");
        await response.arrayBuffer();
      }
      const missing = await runtime.dispatchFetch(
        "https://static-cache.test/assets/notreal-MnOp3456.js",
      );
      expect(missing.status).toBe(404);
      expect(missing.headers.get("cache-control")).not.toContain("immutable");
      await missing.arrayBuffer();
    } finally {
      await runtime.dispose();
      // Recursive cleanup is restricted to the uniquely allocated test fixture.
      expect(dirname(directory)).toBe(resolve(tmpdir()));
      expect(basename(directory).startsWith("kiroku-static-cache-")).toBe(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
