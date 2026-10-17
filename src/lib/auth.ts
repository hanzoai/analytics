import { validateToken } from '@hanzo/iam';
import debug from 'debug';
import { ROLE_PERMISSIONS, ROLES, SHARE_TOKEN_HEADER } from '@/lib/constants';
import { secret, uuid } from '@/lib/crypto';
import { IAM_API, IAM_CLIENT_ID, IAM_ISSUER, IAM_JWKS } from '@/lib/iam';
import { ensureIamOrgTeam } from '@/lib/iam-org';
import { parseToken } from '@/lib/jwt';
import { ensureArray } from '@/lib/utils';
import { createUser, getUserByUsername } from '@/queries/prisma';
import { getUser } from '@/queries/prisma/user';

const log = debug('hanzo:analytics:auth');

/**
 * Hanzo IAM is the single source of authentication. Every API request carries
 * an IAM-issued bearer access token; we verify it here against IAM's signing
 * keys (`validateToken`, keys read from api.hanzo.ai, issuer checked as the
 * `iss` tokens name) — no local password store, no local session minting. The
 * verified IAM identity resolves to (or provisions) the analytics user record
 * that the rest of the app's team/website scoping keys off.
 *
 * The IAM apps whose tokens this API accepts: its own, and the first-party
 * surfaces that mount its views with the viewer's own bearer (the platform
 * console, by brand). IAM_AUDIENCES names them; the token's owner and org still
 * decide what it may read.
 */
const IAM_AUDIENCES = [
  IAM_CLIENT_ID,
  ...(process.env.IAM_AUDIENCES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
];

export function getBearerToken(request: Request) {
  const auth = request.headers.get('authorization');

  return auth?.split(' ')[1];
}

/**
 * Resolve the verified IAM identity to an analytics user, creating one on first
 * login and assigning it to its IAM org's team.
 */
async function resolveIamUser(result: {
  email?: string;
  name?: string;
  /** The home org, from the signed `orgs` claim. */
  org: string;
  claims: Record<string, unknown>;
}) {
  const email =
    result.email ||
    (result.claims.email as string) ||
    (result.claims.preferred_username as string) ||
    result.name;

  if (!email) {
    log('IAM token has no email/username claim');
    return null;
  }

  const existing = await getUserByUsername(email);
  let userId: string;

  if (existing) {
    userId = existing.id;
  } else {
    const created = await createUser({
      id: uuid(),
      username: email,
      // Password auth is owned entirely by IAM; this column is vestigial and
      // never verified. Store an opaque, non-usable value.
      password: uuid(),
      role: ROLES.user,
    });
    userId = created.id;

    // Assign the user to its IAM org's team on first provision.
    const orgSlug =
      result.org ||
      (result.claims.owner as string) ||
      (result.claims.org as string) ||
      (result.claims.organization as string) ||
      '';

    if (orgSlug) {
      await ensureIamOrgTeam(userId, orgSlug);
    }

    // The admin org operates the platform, and the platform's own sites belong to
    // org hanzo, so an admin-org member is a member of that team as well.
    if (orgSlug === 'admin') {
      await ensureIamOrgTeam(userId, 'hanzo');
      log('admin-org member %s joined team hanzo', email);
    }
  }

  return getUser(userId);
}

export async function checkAuth(request: Request) {
  const token = getBearerToken(request);
  const shareToken = await parseShareToken(request);

  let user = null;

  if (token) {
    const result = await validateToken(token, {
      serverUrl: IAM_API,
      issuer: IAM_ISSUER,
      jwksUri: IAM_JWKS,
      clientId: IAM_CLIENT_ID,
      audience: IAM_AUDIENCES,
    });

    if (result.ok) {
      user = await resolveIamUser(result);
    } else {
      const reason = 'reason' in result ? result.reason : 'unknown';
      log('IAM token rejected:', reason);
    }
  }

  log({ token, shareToken, user });

  if (!user?.id && !shareToken) {
    log('User not authorized');
    return null;
  }

  if (user) {
    user.isAdmin = user.role === ROLES.admin;
  }

  return {
    token,
    shareToken,
    user,
  };
}

export async function hasPermission(role: string, permission: string | string[]) {
  return ensureArray(permission).some(e => ROLE_PERMISSIONS[role]?.includes(e));
}

export function parseShareToken(request: Request) {
  try {
    return parseToken(request.headers.get(SHARE_TOKEN_HEADER), secret());
  } catch (e) {
    log(e);
    return null;
  }
}
