/**
 * IAM Organization → Analytics Team mapping.
 *
 * When a user logs in via Hanzo IAM (hanzo.id), the `owner` claim identifies
 * which organization they belong to (e.g. "hanzo", "lux", "zoo").
 *
 * This module maps IAM orgs to Umami "Teams":
 *   - Each IAM org slug gets a deterministic Team (UUID v5 from org slug)
 *   - Users are auto-assigned to their org's team on login
 *   - Websites created under the team are automatically org-scoped
 *   - Cross-org data leakage is prevented by Umami's native team scoping
 *
 * The mapping uses UUID v5 (SHA-1 namespace) so the same org slug always
 * produces the same team ID, making it idempotent across restarts.
 */

import { v5 } from 'uuid';
import { ROLES } from '@/lib/constants';
import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';

// Namespace UUID for generating deterministic team IDs from IAM org slugs.
// This is a fixed UUID used as the namespace for v5 UUID generation.
const IAM_ORG_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace

/**
 * Convert an IAM org slug to a deterministic team UUID.
 * Same slug always produces the same UUID.
 */
export function orgSlugToTeamId(orgSlug: string): string {
  return v5(`hanzo-analytics-org:${orgSlug}`, IAM_ORG_NAMESPACE);
}

/**
 * Ensure the IAM org has a corresponding analytics Team, and the user is a member.
 *
 * This is idempotent — safe to call on every login.
 *
 * @param userId - The analytics user ID
 * @param orgSlug - The IAM organization slug (from `owner` claim)
 */
export async function ensureIamOrgTeam(userId: string, orgSlug: string): Promise<void> {
  if (!orgSlug || orgSlug === 'built-in') {
    // Skip the Casdoor built-in org — it's not a real tenant
    return;
  }

  const teamId = orgSlugToTeamId(orgSlug);
  const teamName = orgSlug.charAt(0).toUpperCase() + orgSlug.slice(1);

  const { client } = prisma;

  // Upsert the team (create if not exists)
  const existingTeam = await client.team.findUnique({ where: { id: teamId } });

  if (!existingTeam) {
    await client.team.create({
      data: {
        id: teamId,
        name: teamName,
      },
    });
  }

  // Check if user is already a member
  const existingMembership = await client.teamUser.findFirst({
    where: { teamId, userId },
  });

  if (!existingMembership) {
    // Check if this is the first member (they become team-owner)
    const memberCount = await client.teamUser.count({ where: { teamId } });
    const role = memberCount === 0 ? ROLES.teamOwner : ROLES.teamMember;

    await client.teamUser.create({
      data: {
        id: uuid(),
        teamId,
        userId,
        role,
      },
    });
  }
}
