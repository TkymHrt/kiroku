import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authenticateMcp } from "./mcp-security";
import { assertCsrf } from "./security";

afterEach(() => {
  vi.restoreAllMocks();
});
describe("MCP-only Access and transport boundary", () => {
  const config = {
    ACCESS_TEAM_DOMAIN: "https://mcp-security-test.cloudflareaccess.com",
    ACCESS_AUD: "browser-audience",
    ACCESS_EMAIL: "owner@example.com",
    MCP_ACCESS_AUD: "mcp-audience",
    MCP_ORIGIN: "https://mcp.example",
    MCP_CURSOR_SECRET: "mcp-test-secret-with-at-least-32-characters",
  };
  it("allows only loopback development and requires complete production configuration", async () => {
    await expect(
      authenticateMcp(new Request("http://127.0.0.1:5173/mcp"), {}, true),
    ).resolves.toBeTruthy();
    for (const [url, dev] of [
      ["http://localhost/mcp", false],
      ["https://mcp.example/mcp", true],
    ] as const)
      await expect(authenticateMcp(new Request(url), {}, dev)).rejects.toMatchObject({
        status: 503,
      });
    await expect(
      authenticateMcp(new Request("https://mcp.example/mcp"), config, false),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("rejects wrong Host/Origin, query strings, absent/forged/expired/wrong-owner JWTs and browser audience", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        keys: [{ ...(await exportJWK(publicKey)), kid: "mcp", alg: "RS256", use: "sig" }],
      }),
    );
    async function request({
      email = "owner@example.com",
      aud = config.MCP_ACCESS_AUD,
      exp = "1h",
      origin,
      host,
      url = "https://mcp.example/mcp",
    }: {
      email?: string;
      aud?: string;
      exp?: string;
      origin?: string;
      host?: string;
      url?: string;
    } = {}) {
      const jwt = await new SignJWT({ email })
        .setProtectedHeader({ alg: "RS256", kid: "mcp" })
        .setIssuedAt()
        .setIssuer(config.ACCESS_TEAM_DOMAIN)
        .setAudience(aud)
        .setExpirationTime(exp)
        .sign(privateKey);
      return new Request(url, {
        method: "POST",
        headers: {
          authorization: "Bearer opaque-managed-oauth-token",
          "cf-access-jwt-assertion": jwt,
          ...(origin ? { origin } : {}),
          ...(host ? { host } : {}),
        },
      });
    }
    await expect(authenticateMcp(await request(), config, false)).resolves.toBe(
      config.MCP_CURSOR_SECRET,
    );
    const forwarded = await request();
    forwarded.headers.delete("authorization");
    await expect(authenticateMcp(forwarded, config, false)).resolves.toBe(config.MCP_CURSOR_SECRET);
    forwarded.headers.set("sec-fetch-site", "same-origin");
    await expect(authenticateMcp(forwarded, config, false)).rejects.toMatchObject({
      status: 403,
      code: "MCP_BROWSER_REJECTED",
    });
    for (const args of [
      { origin: "https://evil.example" },
      { host: "evil.example" },
      { url: "https://other.example/mcp" },
    ])
      await expect(authenticateMcp(await request(args), config, false)).rejects.toMatchObject({
        status: 403,
      });
    await expect(
      authenticateMcp(
        await request({ url: "https://mcp.example/mcp?query=secret" }),
        config,
        false,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      authenticateMcp(await request({ email: "other@example.com" }), config, false),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      authenticateMcp(await request({ aud: config.ACCESS_AUD }), config, false),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateMcp(await request({ exp: "-1h" }), config, false),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateMcp(
        new Request("https://mcp.example/mcp", {
          headers: { authorization: "Bearer forged", "cf-access-jwt-assertion": "not.a.jwt" },
        }),
        config,
        false,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(() =>
      assertCsrf(
        new Request("https://mcp.example/api/diaries/2026-10-20", {
          method: "POST",
          headers: { authorization: "Bearer value" },
        }),
      ),
    ).toThrow();
  });
});
