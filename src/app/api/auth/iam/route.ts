import { NextResponse } from 'next/server';
import { saveAuth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { secret, uuid } from '@/lib/crypto';
import { ensureIamOrgTeam } from '@/lib/iam-org';
import { createSecureToken } from '@/lib/jwt';
import { hashPassword } from '@/lib/password';
import redis from '@/lib/redis';
import { createUser, getUserByUsername } from '@/queries/prisma';

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
const IAM_CLIENT_SECRET =
  process.env.HANZO_IAM_CLIENT_SECRET || process.env.IAM_CLIENT_SECRET || '';

/**
 * GET /api/auth/iam — OAuth callback from external IAM provider.
 *
 * Receives ?code=... from IAM, exchanges for tokens, finds/creates
 * the analytics user, generates a session token, and redirects to /sso.
 *
 * Multi-tenant org scoping:
 *   1. Extracts `owner` claim from IAM token (format: "org/username")
 *   2. Auto-creates a Team for each IAM org (team.id = deterministic UUID from org slug)
 *   3. Assigns the user to the team with `team-member` role (or `team-owner` if first user)
 *   4. Websites created under the team are org-scoped automatically
 */
const BASE_URL = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';

export async function GET(request: Request) {
  if (!IAM_URL || !IAM_CLIENT_ID) {
    return NextResponse.json({ error: 'IAM not configured' }, { status: 501 });
  }

  const url = new URL(request.url);
  // Behind a reverse proxy, request.url resolves to the internal address (e.g. 0.0.0.0:3000).
  // Use BASE_URL or X-Forwarded-Host to determine the real origin.
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (BASE_URL) {
    url.protocol = new URL(BASE_URL).protocol;
    url.host = new URL(BASE_URL).host;
  } else if (forwardedHost) {
    url.protocol = forwardedProto + ':';
    url.host = forwardedHost;
  }
  const code = url.searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(new URL('/login', url.origin));
  }

  try {
    // Exchange authorization code for tokens
    const redirectUri = `${url.origin}/api/auth/iam`;
    const tokenRes = await fetch(`${IAM_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: IAM_CLIENT_ID,
        ...(IAM_CLIENT_SECRET ? { client_secret: IAM_CLIENT_SECRET } : {}),
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      console.error('IAM token exchange failed:', tokenRes.status, await tokenRes.text());
      return NextResponse.redirect(new URL('/login?error=iam_token', url.origin));
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('IAM response missing access_token:', tokenData);
      return NextResponse.redirect(new URL('/login?error=iam_no_token', url.origin));
    }

    // Fetch user info from IAM
    const userRes = await fetch(`${IAM_URL}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      console.error('IAM userinfo failed:', userRes.status);
      return NextResponse.redirect(new URL('/login?error=iam_userinfo', url.origin));
    }

    const iamUser = await userRes.json();

    // Decode JWT access token claims for fields not in userinfo (e.g. owner/org)
    let jwtClaims: Record<string, unknown> = {};
    try {
      const payload = accessToken.split('.')[1];
      jwtClaims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      // Non-JWT token — fall back to userinfo only
    }

    const email = iamUser.email || jwtClaims.email || iamUser.preferred_username || iamUser.name;

    if (!email) {
      console.error('IAM user has no email:', iamUser);
      return NextResponse.redirect(new URL('/login?error=iam_no_email', url.origin));
    }

    // Extract org from JWT claims (owner) or userinfo or gateway header.
    const iamOrgSlug =
      (jwtClaims.owner as string) ||
      iamUser.owner ||
      iamUser.org ||
      iamUser.organization ||
      request.headers.get('x-hanzo-org-id') ||
      '';

    // Find or create the analytics user
    let user = await getUserByUsername(email);

    if (!user) {
      const id = uuid();
      const password = hashPassword(uuid());
      const role = ROLES.user;
      user = await createUser({ id, username: email, password, role });
    }

    // Multi-tenant: ensure the user is assigned to the IAM org team
    if (iamOrgSlug) {
      await ensureIamOrgTeam(user.id, iamOrgSlug);
    }

    // Generate analytics session token
    let token: string;

    if (redis.enabled) {
      token = await saveAuth({ userId: user.id, role: user.role });
    } else {
      token = createSecureToken({ userId: user.id, role: user.role }, secret());
    }

    // Redirect to SSO page which sets the token client-side and navigates to /
    const ssoUrl = new URL('/sso', url.origin);
    ssoUrl.searchParams.set('token', token);
    ssoUrl.searchParams.set('url', '/');

    return NextResponse.redirect(ssoUrl);
  } catch (err) {
    console.error('IAM auth error:', err);
    return NextResponse.redirect(new URL('/login?error=iam_error', url.origin));
  }
}
