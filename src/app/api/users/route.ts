import { z } from 'zod';
import { ROLES } from '@/lib/constants';
import { uuid } from '@/lib/crypto';
import { parseRequest } from '@/lib/request';
import { badRequest, json, unauthorized } from '@/lib/response';
import { canCreateUser } from '@/permissions';
import { createUser, getUserByUsername } from '@/queries/prisma';

export async function POST(request: Request) {
  const schema = z.object({
    id: z.uuid().optional(),
    username: z.string().max(255),
    role: z.string().regex(/admin|user|view-only/i),
  });

  const { auth, body, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  if (!(await canCreateUser(auth))) {
    return unauthorized();
  }

  const { id, username, role } = body;

  const existingUser = await getUserByUsername(username, { showDeleted: true });

  if (existingUser) {
    return badRequest({ message: 'User already exists' });
  }

  const user = await createUser({
    id: id || uuid(),
    username,
    // Authentication is owned by Hanzo IAM; the local password column is
    // vestigial and never verified. Store an opaque, non-usable value.
    password: uuid(),
    role: role ?? ROLES.user,
  });

  return json(user);
}
