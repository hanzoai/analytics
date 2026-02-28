/**
 * GDPR Data Export — GET /api/users/[userId]/export
 *
 * Returns all personal data associated with a user account as JSON.
 * Users can only export their own data; admins can export any user's data.
 */
import { parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { canViewUser } from '@/permissions';
import { getUser, getUserTeams, getUserWebsites } from '@/queries/prisma';

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return error();
  }

  const { userId } = await params;

  if (!(await canViewUser(auth, userId))) {
    return unauthorized();
  }

  const [user, websites, teams] = await Promise.all([
    getUser(userId, { includePassword: false }),
    getUserWebsites(userId),
    getUserTeams(userId),
  ]);

  return json({
    exportedAt: new Date().toISOString(),
    user: {
      id: user?.id,
      username: user?.username,
      displayName: user?.displayName,
      role: user?.role,
      createdAt: user?.createdAt,
      updatedAt: user?.updatedAt,
    },
    websites: websites?.data?.map(w => ({
      id: w.id,
      name: w.name,
      domain: w.domain,
      createdAt: w.createdAt,
    })),
    teams: teams?.data?.map(t => ({
      id: t.teamId,
      name: t.team?.name,
      role: t.role,
      createdAt: t.createdAt,
    })),
  });
}
