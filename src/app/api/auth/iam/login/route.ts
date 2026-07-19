import { NextResponse } from 'next/server';
import {
  discoverEndpoints,
  IAM_CLIENT_ID,
  isIamConfigured,
  redirectUri,
  STATE_COOKIE,
} from '@/lib/iam';

/**
 * GET /api/auth/iam/login — Initiate IAM OAuth flow.
 *
 * Generates a cryptographic state parameter, stores it in a HttpOnly cookie,
 * and redirects to the IAM authorization endpoint (resolved via OIDC discovery).
 */
export async function GET(request: Request) {
  if (!isIamConfigured()) {
    return NextResponse.json({ error: 'IAM not configured' }, { status: 501 });
  }

  const state = crypto.randomUUID();
  const { authorization_endpoint } = await discoverEndpoints();
  const params = new URLSearchParams({
    client_id: IAM_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(request),
    scope: 'openid profile email',
    state,
  });

  const response = NextResponse.redirect(`${authorization_endpoint}?${params}`);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  return response;
}
