/**
 * Websites follow cloud's projects. `sync` takes the projects cloud answered for a
 * person's org and makes the org's team hold exactly one website per project:
 * created when missing, renamed when the project was, and retired when the project
 * is gone. Only project-derived websites (created by no person) are ever retired.
 */

import { ensureOrgTeam } from '@/lib/iam-org';
import prisma from '@/lib/prisma';
import { pixelOf, websiteIdOf } from '@/lib/project';

/** A project as cloud's GET /v1/projects answers it; only what analytics reads. */
export interface CloudProject {
  id: string;
  org: string;
  slug: string;
  name?: string;
  key?: string;
  liveUrl?: string;
  status?: string;
}

export interface ProjectPixel {
  websiteId: string;
  org: string;
  slug: string;
  name: string;
  liveUrl: string;
  pixel: string | null;
}

function hostOf(url?: string) {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

export async function sync(projects: CloudProject[]): Promise<ProjectPixel[]> {
  const { client } = prisma;
  const live = projects.filter(p => p?.org && p?.slug);
  const byOrg = new Map<string, Set<string>>();

  const out: ProjectPixel[] = [];
  for (const p of live) {
    const id = websiteIdOf(p.org, p.slug);
    const name = (p.name || p.slug).slice(0, 100);
    const teamId = await ensureOrgTeam(p.org);
    await client.website.upsert({
      where: { id },
      create: { id, name, domain: hostOf(p.liveUrl), teamId },
      update: { name, teamId, deletedAt: null },
    });
    if (!byOrg.has(p.org)) byOrg.set(p.org, new Set());
    byOrg.get(p.org).add(id);
    out.push({
      websiteId: id,
      org: p.org,
      slug: p.slug,
      name,
      liveUrl: p.liveUrl || '',
      pixel: p.key ? pixelOf(p.key) : null,
    });
  }

  for (const [org, ids] of byOrg) {
    const teamId = await ensureOrgTeam(org);
    await client.website.updateMany({
      where: { teamId, createdBy: null, userId: null, deletedAt: null, id: { notIn: [...ids] } },
      data: { deletedAt: new Date() },
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}
