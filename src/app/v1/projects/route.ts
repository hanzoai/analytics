import { getBearerToken } from '@/lib/auth';
import { CLOUD_URL } from '@/lib/project';
import { type CloudProject, sync } from '@/lib/projects';
import { parseRequest } from '@/lib/request';
import { json, serverError } from '@/lib/response';

/**
 * The caller's cloud projects, each with its website and its default pixel. Cloud's
 * /v1/projects is read with the caller's own IAM bearer, so the org is cloud's
 * answer for that person, and the websites of that org are synced from it.
 */
export async function GET(request: Request) {
  const { error } = await parseRequest(request);

  if (error) {
    return error();
  }

  const res = await fetch(`${CLOUD_URL}/v1/projects`, {
    headers: { Authorization: `Bearer ${getBearerToken(request)}`, Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    return serverError({ message: `cloud answered ${res.status} for /v1/projects` });
  }

  const body = await res.json();
  const projects: CloudProject[] = Array.isArray(body)
    ? body
    : (body?.projects ?? body?.data ?? []);

  return json(await sync(projects));
}
