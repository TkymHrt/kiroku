import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { assertCsrf, authenticate, reusableStaticResponse, securityHeaders } from "./security";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authenticated static response caching", () => {
  const cache = "private, max-age=31536000, immutable";
  const js = "/assets/index-AbCd1234.js";
  const css = "/assets/index-EfGh5678.css";
  const request = (path = js, method = "GET") =>
    new Request(`https://diary.example${path}`, { method });
  const response = (headers: Record<string, string> = {}, status = 200) =>
    new Response(null, {
      status,
      headers: { "Cache-Control": cache, "Content-Type": "text/javascript", ...headers },
    });
  const manifest = () => Response.json({ entry: { file: js.slice(1), css: [css.slice(1)] } });

  it("coalesces manifest reads and preserves only the exact current build's JS/CSS", async () => {
    const assets = { fetch: vi.fn(async (_request: Request) => manifest()) };
    await expect(
      Promise.all([
        reusableStaticResponse(request(), response(), assets),
        reusableStaticResponse(
          request(css, "HEAD"),
          response({ "Content-Type": "text/css" }),
          assets,
        ),
        reusableStaticResponse(request(), response({}, 304), assets),
      ]),
    ).resolves.toEqual([true, true, true]);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(assets.fetch.mock.calls[0][0].url).toBe("https://diary.example/.vite/manifest.json");
    await expect(
      reusableStaticResponse(request("/assets/unknown-IjKl9012.js"), response(), assets),
    ).resolves.toBe(false);
    const headers = new Headers({ "Cache-Control": cache, Pragma: "no-cache" });
    securityHeaders(headers, false, true);
    expect(headers.get("cache-control")).toBe(cache);
    expect(headers.get("pragma")).toBeNull();
    expect(headers.get("x-frame-options")).toBe("DENY");
    securityHeaders(headers, true, true);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("pragma")).toBe("no-cache");
  });

  it("never loads a manifest or reuses API, HTML, downloads, authentication or error responses", async () => {
    const assets = { fetch: vi.fn(async () => manifest()) };
    for (const [path, method, candidate] of [
      ["/api/diaries/2080-01-01", "GET", response()],
      ["/", "GET", response()],
      ["/assets/plain.js", "GET", response()],
      [js, "POST", response()],
      [js, "GET", response({ "Content-Type": "text/html" })],
      [css, "GET", response()],
      [js, "GET", response({ "Set-Cookie": "synthetic=value" })],
      [js, "GET", response({ "Content-Disposition": "attachment" })],
      ...[401, 403, 404, 416, 500].map((status) => [js, "GET", response({}, status)]),
    ] as [string, string, Response][]) {
      await expect(reusableStaticResponse(request(path, method), candidate, assets)).resolves.toBe(
        false,
      );
    }
    expect(assets.fetch).not.toHaveBeenCalled();
    const headers = new Headers({ "Cache-Control": cache });
    securityHeaders(headers);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("pragma")).toBe("no-cache");
  });

  it("uses the exact manifest membership when the deployed provider omits authored cache headers", async () => {
    const assets = { fetch: vi.fn(async () => manifest()) };
    for (const policy of ["public, max-age=0, must-revalidate", "no-store", null]) {
      for (const [path, contentType] of [
        [js, "text/javascript"],
        [css, "text/css"],
      ]) {
        const candidate = new Response(null, {
          headers: {
            "Content-Type": contentType,
            ...(policy ? { "Cache-Control": policy } : {}),
          },
        });
        await expect(reusableStaticResponse(request(path), candidate, assets)).resolves.toBe(true);
        await expect(
          reusableStaticResponse(request("/assets/unknown-IjKl9012.js"), candidate, assets),
        ).resolves.toBe(false);
      }
    }
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the manifest binding is missing, invalid or unavailable", async () => {
    await expect(reusableStaticResponse(request(), response())).resolves.toBe(false);
    for (const load of [
      async () => new Response(null, { status: 404 }),
      async () => new Response("invalid JSON"),
      async () => Response.json([]),
      async () => Response.json({ entry: { file: 1, css: [null, false] } }),
      async () => {
        throw new Error("synthetic manifest failure");
      },
    ]) {
      const assets = { fetch: vi.fn(load) };
      await expect(reusableStaticResponse(request(), response(), assets)).resolves.toBe(false);
      await expect(reusableStaticResponse(request(), response(), assets)).resolves.toBe(false);
      expect(assets.fetch).toHaveBeenCalledTimes(1);
    }
  });
});

describe("Access verification and CSRF", () => {
  const config = {
    ACCESS_TEAM_DOMAIN: "https://test-kiroku.cloudflareaccess.com",
    ACCESS_AUD: "diary-audience",
    ACCESS_EMAIL: "owner@example.com",
  };

  it("allows only loopback development to bypass Access and fails closed in production", async () => {
    await expect(
      authenticate(new Request("http://localhost:5173/api/session"), {}, true),
    ).resolves.toBe("local-development");
    await expect(
      authenticate(new Request("https://diary.example/api/session"), {}, true),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      authenticate(new Request("http://localhost:5173/api/session"), {}, false),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      authenticate(new Request("https://diary.example/api/session"), config, false),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("requires a valid JWT signature, issuer, audience, expiry, and the individual owner", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }] }),
    );
    async function request(
      email: string,
      audience = config.ACCESS_AUD,
      issuer = config.ACCESS_TEAM_DOMAIN,
      expiration: number | string = "1h",
    ) {
      const token = await new SignJWT({ email })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime(expiration)
        .sign(privateKey);
      return new Request("https://diary.example/api/session", {
        headers: { "cf-access-jwt-assertion": token },
      });
    }
    await expect(authenticate(await request("owner@example.com"), config, false)).resolves.toBe(
      "owner@example.com",
    );
    await expect(
      authenticate(await request("other@example.com"), config, false),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      authenticate(await request("owner@example.com", "another-app"), config, false),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticate(
        await request("owner@example.com", config.ACCESS_AUD, "https://evil.example"),
        config,
        false,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticate(
        await request("owner@example.com", config.ACCESS_AUD, config.ACCESS_TEAM_DOMAIN, 1),
        config,
        false,
      ),
    ).rejects.toMatchObject({ status: 401 });
    const forged = new Request("https://diary.example", {
      headers: { "cf-access-jwt-assertion": "not.a.signature" },
    });
    await expect(authenticate(forged, config, false)).rejects.toMatchObject({ status: 401 });
  });

  it("refuses cross-origin or missing-CSRF writes", () => {
    const make = (headers: HeadersInit) =>
      new Request("https://diary.example/api/diaries/2026-10-18", { method: "POST", headers });
    expect(() =>
      assertCsrf(
        make({
          origin: "https://diary.example",
          "x-kiroku-csrf": "1",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertCsrf(make({ origin: "https://evil.example", "x-kiroku-csrf": "1" })),
    ).toThrow();
    expect(() => assertCsrf(make({ origin: "https://diary.example" }))).toThrow();
    expect(() =>
      assertCsrf(
        make({
          origin: "https://diary.example",
          "x-kiroku-csrf": "1",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toThrow();
  });

  it("sets private response protections and disables external image fetching", () => {
    const headers = new Headers();
    securityHeaders(headers);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("content-security-policy")).toContain("img-src 'self' data:");
  });
});
