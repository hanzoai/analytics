/**
 * Hanzo IAM (hanzo.id) OIDC integration — server-only.
 *
 * Single source of truth for the analytics ↔ IAM OAuth flow. Both the login
 * initiation (`/api/auth/iam/login`) and the callback (`/api/auth/iam`) resolve
 * their endpoints and public origin here so the two halves of the handshake are
 * guaranteed to agree (OAuth requires a byte-identical redirect_uri on both).
 *
 * Endpoints are discovered from `${IAM_URL}/.well-known/openid-configuration`
 * rather than hardcoded, so analytics tracks IAM's real paths automatically.
 * hanzo.id serves the OIDC endpoints under `/v1/iam/oauth/*` (NOT `/oauth/*`),
 * which is also the discovery fallback below.
 *
 * DO NOT import this module from a client component: it reads IAM_CLIENT_SECRET
 * and performs server-to-server fetches. Client-facing display config lives in
 * `@/lib/branding`.
 */

export const IAM_URL =
  process.env.HANZO_IAM_URL ||
  process.env.NEXT_PUBLIC_HANZO_IAM_URL ||
  process.env.IAM_URL ||
  process.env.NEXT_PUBLIC_IAM_URL ||
  '';

export const IAM_CLIENT_ID =
  process.env.HANZO_IAM_CLIENT_ID ||
  process.env.NEXT_PUBLIC_HANZO_IAM_CLIENT_ID ||
  process.env.IAM_CLIENT_ID ||
  process.env.NEXT_PUBLIC_IAM_CLIENT_ID ||
  '';

export const IAM_CLIENT_SECRET =
  process.env.HANZO_IAM_CLIENT_SECRET || process.env.IAM_CLIENT_SECRET || '';

export const STATE_COOKIE = 'analytics_oauth_state';

/** Whether IAM single-sign-on is configured (URL + client id present). */
export function isIamConfigured(): boolean {
  return !!(IAM_URL && IAM_CLIENT_ID);
}

/**
 * The public-facing origin of this analytics deployment (e.g.
 * `https://analytics.hanzo.ai`), used to build the OAuth `redirect_uri`.
 *
 * Behind the ingress, `request.url` resolves to the internal listen address
 * (`0.0.0.0:3000`), which leaks `:3000` into the redirect_uri and gets the
 * request rejected by IAM as an unregistered callback. We therefore prefer an
 * explicit BASE_URL, then the forwarded host, and always strip the internal
 * service port for non-localhost hosts.
 */
export function resolvePublicOrigin(request: Request): string {
  const configured = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
  if (configured) {
    return new URL(configured).origin;
  }

  const forwardedHost = (request.headers.get('x-forwarded-host') || '').split(',')[0].trim();
  const host = forwardedHost || request.headers.get('host') || '';
  const proto = (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim() || 'https';

  // Keep the dev port for localhost; strip the internal service port in prod.
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const cleanHost = isLocal ? host : host.replace(/:\d+$/, '');

  return `${proto}://${cleanHost}`;
}

/** The OAuth redirect_uri IAM must have registered for this deployment. */
export function redirectUri(request: Request): string {
  return `${resolvePublicOrigin(request)}/api/auth/iam`;
}

export interface OidcEndpoints {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

function fallbackEndpoints(): OidcEndpoints {
  return {
    authorization_endpoint: `${IAM_URL}/v1/iam/oauth/authorize`,
    token_endpoint: `${IAM_URL}/v1/iam/oauth/token`,
    userinfo_endpoint: `${IAM_URL}/v1/iam/oauth/userinfo`,
  };
}

let cached: OidcEndpoints | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Resolve IAM's OAuth endpoints from OIDC discovery, with the canonical
 * hanzo.id `/v1/iam/oauth/*` paths as a fallback. Cached in-process for 1h.
 */
export async function discoverEndpoints(): Promise<OidcEndpoints> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  const fallback = fallbackEndpoints();

  try {
    const res = await fetch(`${IAM_URL}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const doc = (await res.json()) as Partial<OidcEndpoints>;
      cached = {
        authorization_endpoint: doc.authorization_endpoint || fallback.authorization_endpoint,
        token_endpoint: doc.token_endpoint || fallback.token_endpoint,
        userinfo_endpoint: doc.userinfo_endpoint || fallback.userinfo_endpoint,
      };
      cachedAt = now;
      return cached;
    }
  } catch {
    // Discovery unreachable — fall back to canonical paths (don't cache).
  }

  return fallback;
}
