/**
 * Hanzo IAM for this app: who signs people in, and where IAM is asked.
 *
 * Hanzo signs in on hanzo.ai. A signed-out person is sent to `SIGNIN`/login
 * (/signup for a new account) carrying THIS app's own authorize request: client
 * `hanzo-analytics`, callback `<origin>/auth/callback`, a fresh state and S256
 * challenge whose verifier the SDK keeps in this origin's storage. hanzo.ai's
 * page finishes it (@hanzo/iam `asked`/`ask`): "Continue as" for a person
 * signed in there, its own sign-in otherwise. IAM mints the code for this
 * client and callback, and /auth/callback exchanges it here.
 *
 * Every IAM call the browser makes (discovery, token, refresh, userinfo,
 * revocation) goes to `IAM_API`. The issuer `https://hanzo.id` is what tokens
 * name (`iss`), never a host anything here calls or links.
 */
import type { IAMConfig } from '@hanzo/iam/browser';

/** The one sign-in site. */
export const SIGNIN = 'https://hanzo.ai';

/** Where IAM answers: discovery, token, userinfo, revocation and JWKS. */
export const IAM_API = 'https://api.hanzo.ai';

/** The issuer IAM's tokens name. Checked, never fetched. */
export const IAM_ISSUER = 'https://hanzo.id';

/** IAM's signing keys, read from the API host. */
export const IAM_JWKS = `${IAM_API}/v1/iam/.well-known/jwks`;

export const IAM_CLIENT_ID = process.env.NEXT_PUBLIC_IAM_CLIENT_ID || 'hanzo-analytics';
export const IAM_ORG = process.env.NEXT_PUBLIC_IAM_ORG || 'hanzo';

export const CALLBACK_PATH = '/auth/callback';

const RETURN_TO = 'analytics_return_to';

/** The SDK configuration for this origin. Browser only (the callback names the origin). */
export function iamConfig(origin: string): IAMConfig {
  return {
    serverUrl: IAM_API,
    proxyBaseUrl: IAM_API,
    clientId: IAM_CLIENT_ID,
    organization: IAM_ORG,
    redirectUri: `${origin}${CALLBACK_PATH}`,
    scope: 'openid profile email',
  };
}

/** The sign-in site's page for `mode`, carrying the query of the authorize address the SDK built. Pure. */
export function signinAddress(site: string, mode: 'login' | 'signup', authorize: string): string {
  return `${site.replace(/\/+$/, '')}/${mode}${new URL(authorize).search}`;
}

/** An in-app path to come back to, or null: never another origin, never the sign-in pages themselves. */
export function returnPath(path: string | null | undefined): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\'))
    return null;
  if (/^\/(login|signup|logout|auth\/)/.test(path)) return null;
  return path;
}

/** Remember the page asked for, so the callback lands there. */
export function stashReturnTo(path: string): void {
  const keep = returnPath(path);
  if (!keep) return;
  try {
    window.sessionStorage.setItem(RETURN_TO, keep);
  } catch {
    // sessionStorage unavailable: the callback lands on /.
  }
}

/** Take the page asked for (default `/`), clearing it. */
export function takeReturnTo(): string {
  try {
    const to = window.sessionStorage.getItem(RETURN_TO);
    window.sessionStorage.removeItem(RETURN_TO);
    return returnPath(to) ?? '/';
  } catch {
    return '/';
  }
}

/**
 * Leave for the sign-in site with this app's own request. `replace`, so Back
 * does not land on a page that only leaves again.
 */
export async function leaveForSignin(
  sdk: { getSigninUrl(): Promise<string> },
  mode: 'login' | 'signup',
): Promise<void> {
  window.location.replace(signinAddress(SIGNIN, mode, await sdk.getSigninUrl()));
}
