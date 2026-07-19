import { NextResponse } from 'next/server';
import { saveAuth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { secret, uuid } from '@/lib/crypto';
import {
  discoverEndpoints,
  IAM_CLIENT_ID,
  IAM_CLIENT_SECRET,
  isIamConfigured,
  redirectUri,
  resolvePublicOrigin,
  STATE_COOKIE,
} from '@/lib/iam';
import { ensureIamOrgTeam } from '@/lib/iam-org';
import { createSecureToken } from '@/lib/jwt';
import { hashPassword } from '@/lib/password';
import redis from '@/lib/redis';
import { createUser, getUserByUsername } from '@/queries/prisma';

/**
 * GET /api/auth/iam — OAuth callback from Hanzo IAM (hanzo.id).
 *
 * Receives ?code=... from IAM, exchanges for tokens, finds/creates the
 * analytics user, generates a session token, and redirects to /sso.
 *
 * Multi-tenant org scoping:
 *   1. Extracts `owner` claim from IAM token (format: "org/username")
 *   2. Auto-creates a Team for each IAM org (team.id = deterministic UUID from org slug)
 *   3. Assigns the user to the team (team-owner if first, else team-member)
 *   4. Websites created under the team are org-scoped automatically
 */
export async function GET(request: Request) {
  if (!isIamConfigured()) {
    return NextResponse.json({ error: 'IAM not configured' }, { status: 501 });
  }

  const origin = resolvePublicOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(new URL('/login', origin));
  }

  // Validate OAuth state parameter (CSRF protection)
  const stateParam = url.searchParams.get('state');
  const cookies = request.headers.get('cookie') || '';
  const stateCookie = cookies
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${STATE_COOKIE}=`))
    ?.split('=')[1];
  if (!stateParam || !stateCookie || stateParam !== stateCookie) {
    console.error('OAuth state mismatch:', {
      stateParam: !!stateParam,
      stateCookie: !!stateCookie,
    });
    return NextResponse.redirect(new URL('/login?error=iam_state', origin));
  }

  try {
    const { token_endpoint, userinfo_endpoint } = await discoverEndpoints();

    // Exchange authorization code for tokens. redirect_uri must byte-match the
    // one sent at /api/auth/iam/login (both come from redirectUri()).
    const tokenRes = await fetch(token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: IAM_CLIENT_ID,
        ...(IAM_CLIENT_SECRET ? { client_secret: IAM_CLIENT_SECRET } : {}),
        code,
        redirect_uri: redirectUri(request),
      }),
    });

    if (!tokenRes.ok) {
      console.error('IAM token exchange failed:', tokenRes.status, await tokenRes.text());
      return NextResponse.redirect(new URL('/login?error=iam_token', origin));
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('IAM response missing access_token');
      return NextResponse.redirect(new URL('/login?error=iam_no_token', origin));
    }

    // Fetch user info from IAM
    const userRes = await fetch(userinfo_endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      console.error('IAM userinfo failed:', userRes.status);
      return NextResponse.redirect(new URL('/login?error=iam_userinfo', origin));
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
      return NextResponse.redirect(new URL('/login?error=iam_no_email', origin));
    }

    // Extract org from JWT claims (owner) or userinfo or gateway header.
    const iamOrgSlug =
      (jwtClaims.owner as string) ||
      iamUser.owner ||
      iamUser.org ||
      iamUser.organization ||
      request.headers.get('x-iam-org-id') ||
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
    const ssoUrl = new URL('/sso', origin);
    ssoUrl.searchParams.set('token', token);
    ssoUrl.searchParams.set('url', '/');

    const response = NextResponse.redirect(ssoUrl);
    // Clear the OAuth state cookie
    response.cookies.set(STATE_COOKIE, '', { maxAge: 0, path: '/' });
    return response;
  } catch (err) {
    console.error('IAM auth error:', err);
    return NextResponse.redirect(new URL('/login?error=iam_error', origin));
  }
}
