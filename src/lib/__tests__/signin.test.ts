/**
 * Hanzo signs in on hanzo.ai with this app's own request, and nothing here
 * calls or links the issuer's host.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CALLBACK_PATH,
  IAM_API,
  IAM_ISSUER,
  IAM_JWKS,
  iamConfig,
  returnPath,
  SIGNIN,
  signinAddress,
} from '@/lib/iam';

const ROOT = path.resolve(__dirname, '../../..');

describe('the sign-in address', () => {
  const authorize =
    'https://hanzo.id/v1/iam/oauth/authorize?client_id=hanzo-analytics&redirect_uri=https%3A%2F%2Fanalytics.hanzo.ai%2Fauth%2Fcallback&response_type=code&scope=openid+profile+email&state=s&code_challenge=c&code_challenge_method=S256';

  it('is hanzo.ai/login carrying the SDK’s authorize query, the issuer’s host dropped', () => {
    const to = new URL(signinAddress(SIGNIN, 'login', authorize));
    expect(to.origin + to.pathname).toBe('https://hanzo.ai/login');
    expect(to.search).toBe(new URL(authorize).search);
    expect(to.searchParams.get('client_id')).toBe('hanzo-analytics');
    expect(to.searchParams.get('redirect_uri')).toBe('https://analytics.hanzo.ai/auth/callback');
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('is hanzo.ai/signup for a new account', () => {
    expect(new URL(signinAddress(`${SIGNIN}/`, 'signup', authorize)).pathname).toBe('/signup');
  });
});

describe('the SDK configuration', () => {
  it('asks IAM at api.hanzo.ai and calls back to this origin', () => {
    const c = iamConfig('https://analytics.hanzo.ai');
    expect(c.serverUrl).toBe('https://api.hanzo.ai');
    expect(c.proxyBaseUrl).toBe('https://api.hanzo.ai');
    expect(c.clientId).toBe('hanzo-analytics');
    expect(c.redirectUri).toBe(`https://analytics.hanzo.ai${CALLBACK_PATH}`);
  });

  it('reads keys from the API host and checks the issuer tokens name', () => {
    expect(IAM_JWKS.startsWith(`${IAM_API}/`)).toBe(true);
    expect(IAM_ISSUER).toBe('https://hanzo.id');
  });
});

describe('the page to come back to', () => {
  it('is an in-app path', () => {
    expect(returnPath('/settings/profile?x=1')).toBe('/settings/profile?x=1');
  });

  it('is never another origin or a sign-in page', () => {
    for (const p of [
      'https://evil.example/',
      '//evil.example/',
      '/\\evil.example',
      '/login',
      '/signup',
      '/logout',
      '/auth/callback?code=x',
      '',
      null,
    ]) {
      expect(returnPath(p)).toBeNull();
    }
  });
});

describe('nothing calls or links the issuer’s host', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'lang', '.next', '__tests__'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'docker'));

  it('names hanzo.id only as the issuer', () => {
    const hits = files.flatMap(f =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .filter(l => /hanzo\.id(?![a-z])/.test(l))
        .map(l => `${path.relative(ROOT, f)}: ${l.trim()}`),
    );
    expect(hits.filter(h => !h.startsWith('src/lib/iam.ts:'))).toEqual([]);
    expect(fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8')).not.toMatch(
      /hanzo\.id(?![a-z])/,
    );
  });
});
