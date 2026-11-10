import { applyHostMessage, isTrustedHostOrigin, tokenExp, tokenExpired } from '@/lib/embed';

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.sig`;
}

describe('workspace embed protocol', () => {
  it('accepts trusted Hanzo workspace origins and rejects untrusted origins', () => {
    expect(isTrustedHostOrigin('https://hanzo.app')).toBe(true);
    expect(isTrustedHostOrigin('https://hanzo.ai')).toBe(true);
    expect(isTrustedHostOrigin('https://hanzo.team')).toBe(true);
    expect(isTrustedHostOrigin('https://evil.example')).toBe(false);
    expect(isTrustedHostOrigin('')).toBe(false);
  });

  it('parses JWT expiration and detects expired tokens', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const pastExp = Math.floor(Date.now() / 1000) - 60;
    const live = makeJwt({ sub: 'hanzo/alice', exp: futureExp });
    const dead = makeJwt({ sub: 'hanzo/alice', exp: pastExp });

    expect(tokenExp(live)).toBe(futureExp);
    expect(tokenExpired(live)).toBe(false);
    expect(tokenExpired(dead)).toBe(true);
    expect(tokenExpired('')).toBe(true);
  });

  it('ignores non-host messages and recognizes hanzo:host payloads', () => {
    expect(applyHostMessage(null)).toEqual({ recognized: false, tokenChanged: false });
    expect(applyHostMessage({ type: 'other' })).toEqual({
      recognized: false,
      tokenChanged: false,
    });

    const res = applyHostMessage({
      type: 'hanzo:host',
      theme: 'light',
      org: 'hanzo',
    });
    expect(res.recognized).toBe(true);
    expect(res.theme).toBe('light');
    expect(res.org).toBe('hanzo');
  });
});
