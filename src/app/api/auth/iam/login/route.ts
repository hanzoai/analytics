import { NextResponse } from 'next/server';

const IAM_URL =
  process.env.HANZO_IAM_URL ||
  process.env.NEXT_PUBLIC_HANZO_IAM_URL ||
  process.env.IAM_URL ||
  process.env.NEXT_PUBLIC_IAM_URL ||
  '';
const IAM_CLIENT_ID =
  process.env.HANZO_IAM_CLIENT_ID ||
  process.env.NEXT_PUBLIC_HANZO_IAM_CLIENT_ID ||
  process.env.IAM_CLIENT_ID ||
  process.env.NEXT_PUBLIC_IAM_CLIENT_ID ||
  '';
const BASE_URL = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
const STATE_COOKIE = 'analytics_oauth_state';

/**
 * GET /api/auth/iam/login — Initiate IAM OAuth flow.
 *
 * Generates a cryptographic state parameter, stores it in a HttpOnly cookie,
 * and redirects to the IAM authorization endpoint.
 */
export async function GET(request: Request) {
  if (!IAM_URL || !IAM_CLIENT_ID) {
    return NextResponse.json({ error: 'IAM not configured' }, { status: 501 });
  }

  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (BASE_URL) {
    url.protocol = new URL(BASE_URL).protocol;
    url.host = new URL(BASE_URL).host;
  } else if (forwardedHost) {
    url.protocol = forwardedProto + ':';
    url.host = forwardedHost;
  }

  const state = crypto.randomUUID();
  const redirectUri = `${url.origin}/api/auth/iam`;
  const params = new URLSearchParams({
    client_id: IAM_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
  });

  const response = NextResponse.redirect(`${IAM_URL}/oauth/authorize?${params}`);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  return response;
}
