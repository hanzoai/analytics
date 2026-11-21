/**
 * A token is accepted under either platform issuer while the issuer moves to hanzo.ai, each
 * matched exactly, and never under an organization's own issuer (https://hanzo.ai/<org>).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { validateToken } from '@hanzo/iam';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IAM_ISSUERS } from '../iam';

let server: Server;
let jwksUri = '';
let key: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  jwksUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`;
});

afterAll(() => new Promise<void>(r => server.close(() => r())));

const token = (iss: string) =>
  new SignJWT({ sub: 'u', orgs: [{ org: 'acme', role: 'member' }] })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(iss)
    .setAudience('hanzo-analytics')
    .setExpirationTime('5m')
    .sign(key);

const check = async (iss: string) =>
  validateToken(await token(iss), {
    serverUrl: 'https://api.hanzo.ai',
    issuer: IAM_ISSUERS,
    jwksUri,
    clientId: 'hanzo-analytics',
    audience: ['hanzo-analytics'],
  });

describe('the issuers analytics accepts', () => {
  it('are the two platform issuers, exactly', () => {
    expect(IAM_ISSUERS).toEqual(['https://hanzo.id', 'https://hanzo.ai']);
  });

  it('pass under either platform issuer', async () => {
    for (const iss of IAM_ISSUERS) expect((await check(iss)).ok).toBe(true);
  });

  it('refuse an organization issuer and lookalikes', async () => {
    for (const iss of ['https://hanzo.ai/acme', 'https://hanzo.ai/', 'https://hanzo.ai.evil.test', 'http://hanzo.ai']) {
      expect(await check(iss)).toEqual({ ok: false, reason: 'iam_issuer_invalid' });
    }
  });
});
