import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { assertCsrf, authenticate, securityHeaders } from './security';

afterEach(() => { vi.restoreAllMocks(); });

describe('Access verification and CSRF', () => {
  const config = { ACCESS_TEAM_DOMAIN: 'https://test-kiroku.cloudflareaccess.com', ACCESS_AUD: 'diary-audience', ACCESS_EMAIL: 'owner@example.com' };

  it('allows only loopback development to bypass Access and fails closed in production', async () => {
    await expect(authenticate(new Request('http://localhost:5173/api/session'), {}, true)).resolves.toBe('local-development');
    await expect(authenticate(new Request('https://diary.example/api/session'), {}, true)).rejects.toMatchObject({ status: 503 });
    await expect(authenticate(new Request('http://localhost:5173/api/session'), {}, false)).rejects.toMatchObject({ status: 503 });
    await expect(authenticate(new Request('https://diary.example/api/session'), config, false)).rejects.toMatchObject({ status: 401 });
  });

  it('requires a valid JWT signature, issuer, audience, expiry, and the individual owner', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] }));
    async function request(email: string, audience = config.ACCESS_AUD, issuer = config.ACCESS_TEAM_DOMAIN, expiration: number | string = '1h') {
      const token = await new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuedAt().setIssuer(issuer).setAudience(audience).setExpirationTime(expiration).sign(privateKey);
      return new Request('https://diary.example/api/session', { headers: { 'cf-access-jwt-assertion': token } });
    }
    await expect(authenticate(await request('owner@example.com'), config, false)).resolves.toBe('owner@example.com');
    await expect(authenticate(await request('other@example.com'), config, false)).rejects.toMatchObject({ status: 403 });
    await expect(authenticate(await request('owner@example.com', 'another-app'), config, false)).rejects.toMatchObject({ status: 401 });
    await expect(authenticate(await request('owner@example.com', config.ACCESS_AUD, 'https://evil.example'), config, false)).rejects.toMatchObject({ status: 401 });
    await expect(authenticate(await request('owner@example.com', config.ACCESS_AUD, config.ACCESS_TEAM_DOMAIN, 1), config, false)).rejects.toMatchObject({ status: 401 });
    const forged = new Request('https://diary.example', { headers: { 'cf-access-jwt-assertion': 'not.a.signature' } });
    await expect(authenticate(forged, config, false)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses cross-origin or missing-CSRF writes', () => {
    const make = (headers: HeadersInit) => new Request('https://diary.example/api/diaries/2026-10-18', { method: 'POST', headers });
    expect(() => assertCsrf(make({ origin: 'https://diary.example', 'x-kiroku-csrf': '1', 'sec-fetch-site': 'same-origin' }))).not.toThrow();
    expect(() => assertCsrf(make({ origin: 'https://evil.example', 'x-kiroku-csrf': '1' }))).toThrow();
    expect(() => assertCsrf(make({ origin: 'https://diary.example' }))).toThrow();
    expect(() => assertCsrf(make({ origin: 'https://diary.example', 'x-kiroku-csrf': '1', 'sec-fetch-site': 'cross-site' }))).toThrow();
  });

  it('sets private response protections and disables external image fetching', () => {
    const headers = new Headers();
    securityHeaders(headers);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('content-security-policy')).toContain("img-src 'self' data:");
  });
});
