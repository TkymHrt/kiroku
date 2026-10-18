import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ApiError } from './errors';

export interface AccessConfig { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; ACCESS_EMAIL?: string }
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function isLoopback(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export async function authenticate(request: Request, config: AccessConfig, development: boolean): Promise<string> {
  if (development && isLoopback(request)) return 'local-development';
  const { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: audience, ACCESS_EMAIL: owner } = config;
  if (!domain || !audience || !owner) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', '認証設定が完了していないためアクセスできません。');
  }
  let issuer: URL;
  try { issuer = new URL(domain); } catch { throw new ApiError(503, 'AUTH_NOT_CONFIGURED', '認証設定を確認してください。'); }
  if (issuer.protocol !== 'https:' || !issuer.hostname.endsWith('.cloudflareaccess.com') || issuer.pathname !== '/' || issuer.search || issuer.hash || issuer.username || issuer.password) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', '認証設定を確認してください。');
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw new ApiError(401, 'AUTH_REQUIRED', '再認証が必要です。端末の下書きは保持しています。');
  const origin = issuer.origin;
  let keys = keySets.get(origin);
  if (!keys) {
    keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', origin), { timeoutDuration: 5_000 });
    keySets.set(origin, keys);
  }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: origin, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'email'] });
    if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== owner.toLowerCase()) {
      throw new ApiError(403, 'ACCESS_DENIED', 'このアカウントにはアクセス権がありません。');
    }
    return payload.email;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'AUTH_REQUIRED', '認証を確認できませんでした。再認証してください。端末の下書きは保持しています。');
  }
}

export function assertCsrf(request: Request): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (origin !== new URL(request.url).origin || request.headers.get('x-kiroku-csrf') !== '1'
    || (fetchSite && fetchSite !== 'same-origin')) {
    throw new ApiError(403, 'CSRF_REJECTED', '送信元を確認できませんでした。同じアプリ画面から再試行してください。');
  }
}

export function securityHeaders(headers: Headers, development = false): void {
  headers.set('Cache-Control', 'no-store');
  headers.set('Pragma', 'no-cache');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  // Inline style attributes are used by CodeMirror; no inline script is needed.
  headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self'${development ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${development ? ' ws: wss:' : ''}; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
}
