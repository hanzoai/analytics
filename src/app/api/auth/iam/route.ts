import { NextResponse } from 'next/server';
import { saveAuth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { secret, uuid } from '@/lib/crypto';
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
 */
export async function GET(request: Request) {
  if (!IAM_URL || !IAM_CLIENT_ID) {
    return NextResponse.json({ error: 'IAM not configured' }, { status: 501 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(new URL('/login', url.origin));
  }

  try {
    // Exchange authorization code for tokens
    const redirectUri = `${url.origin}/api/auth/iam`;
    const tokenRes = await fetch(`${IAM_URL}/api/login/oauth/access_token`, {
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
    const userRes = await fetch(`${IAM_URL}/api/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      console.error('IAM userinfo failed:', userRes.status);
      return NextResponse.redirect(new URL('/login?error=iam_userinfo', url.origin));
    }

    const iamUser = await userRes.json();
    const email = iamUser.email || iamUser.preferred_username || iamUser.name;

    if (!email) {
      console.error('IAM user has no email:', iamUser);
      return NextResponse.redirect(new URL('/login?error=iam_no_email', url.origin));
    }

    // Find or create the analytics user
    let user = await getUserByUsername(email);

    if (!user) {
      const id = uuid();
      const password = hashPassword(uuid());
      const role = ROLES.user;
      user = await createUser({ id, username: email, password, role });
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
