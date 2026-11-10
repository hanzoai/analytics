/**
 * Embedded workspace protocol for Hanzo Analytics (`?embed=1` inside hanzo.app,
 * hanzo.ai, and hanzo.team).
 *
 * Mirrors `hanzoai/console` (`src/lib/embed.ts`) and `@hanzo/app` (`Hosted.tsx`):
 *   - Frame -> Host: `{ type: 'hanzo:ready' }`, `{ type: 'hanzo:navigate', href }`
 *   - Host -> Frame: `{ type: 'hanzo:host', theme, accent, density, org, token }`
 */
import { usableStorage } from '@hanzo/iam/browser';

const FRAMED_KEY = 'hanzo.analytics.framed';
const ACCESS_TOKEN_KEY = 'hanzo_iam_access_token';
const EXPIRES_AT_KEY = 'hanzo_iam_expires_at';
const THEME_KEY = 'umami.theme';

/** Workspace origins allowed to embed Analytics (`?embed=1`) and pass `hanzo:host`. */
export const TRUSTED_HOST_ORIGINS = new Set([
  'https://hanzo.app',
  'https://hanzo.ai',
  'https://hanzo.team',
]);

/** True when `origin` is a trusted workspace parent origin (or same-origin). */
export function isTrustedHostOrigin(origin: string): boolean {
  if (!origin) return false;
  if (TRUSTED_HOST_ORIGINS.has(origin)) return true;
  if (typeof window !== 'undefined' && origin === window.location.origin) return true;
  return false;
}

/**
 * True when Analytics is running inside a workspace iframe (`?embed=1` or
 * `window.self !== window.top`). Persists in `sessionStorage` so internal route
 * transitions keep framed mode active for the tab's lifetime.
 */
export function isFramed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('embed') === '1') {
      try {
        window.sessionStorage.setItem(FRAMED_KEY, '1');
      } catch {
        // storage unavailable
      }
      return true;
    }
    try {
      if (window.sessionStorage.getItem(FRAMED_KEY) === '1') return true;
    } catch {
      // storage unavailable
    }
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** Extract `exp` (epoch seconds) from a JWT payload without verifying signature. */
export function tokenExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const raw =
      typeof atob === 'function'
        ? atob(b64 + pad)
        : Buffer.from(b64 + pad, 'base64').toString('utf8');
    const claims = JSON.parse(raw) as { exp?: unknown };
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp : null;
  } catch {
    return null;
  }
}

/** True when `token` is missing or its `exp` claim is within 30s of expiring. */
export function tokenExpired(token: string | null | undefined, nowMs = Date.now()): boolean {
  if (!token) return true;
  const exp = tokenExp(token);
  if (exp === null) return false;
  return exp * 1000 <= nowMs + 30_000;
}

/** True when a non-expired IAM access token is already present in browser storage. */
export function hasStoredIamSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const store = usableStorage();
    const token = store?.getItem(ACCESS_TOKEN_KEY);
    return !!token && !tokenExpired(token);
  } catch {
    return false;
  }
}

export interface HostMessage {
  type: 'hanzo:host';
  theme?: 'light' | 'dark';
  accent?: string;
  density?: string;
  org?: string;
  token?: string;
}

/**
 * Apply a `hanzo:host` message from the parent workspace frame:
 *   - syncs light/dark theme on `<html>` and returns `theme`
 *   - stores a non-expired IAM bearer token in `usableStorage()` when provided
 */
export function applyHostMessage(data: unknown): {
  recognized: boolean;
  tokenChanged: boolean;
  theme?: 'light' | 'dark';
  org?: string;
} {
  if (!data || typeof data !== 'object') {
    return { recognized: false, tokenChanged: false };
  }
  const msg = data as Partial<HostMessage>;
  if (msg.type !== 'hanzo:host') {
    return { recognized: false, tokenChanged: false };
  }

  let theme: 'light' | 'dark' | undefined;
  if (msg.theme === 'dark' || msg.theme === 'light') {
    theme = msg.theme;
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.setAttribute('data-theme', theme);
      root.classList.toggle('dark', theme === 'dark');
      root.classList.toggle('light', theme === 'light');
      root.style.colorScheme = theme;
      try {
        usableStorage()?.setItem(THEME_KEY, theme);
      } catch {
        // storage unavailable
      }
    }
  }

  let tokenChanged = false;
  if (typeof msg.token === 'string' && msg.token.trim() && typeof window !== 'undefined') {
    const incoming = msg.token.trim();
    if (!tokenExpired(incoming)) {
      try {
        const store = usableStorage();
        const existing = store?.getItem(ACCESS_TOKEN_KEY);
        if (store && (!existing || tokenExpired(existing) || existing !== incoming)) {
          store.setItem(ACCESS_TOKEN_KEY, incoming);
          const exp = tokenExp(incoming);
          if (exp !== null) {
            store.setItem(EXPIRES_AT_KEY, String(exp * 1000));
          }
          tokenChanged = true;
        }
      } catch {
        // storage unavailable
      }
    }
  }

  const org = typeof msg.org === 'string' && msg.org.trim() ? msg.org.trim() : undefined;

  return { recognized: true, tokenChanged, theme, org };
}

/** Post a lifecycle or navigation message to the parent workspace frame when framed. */
export function postToHost(
  msg: { type: 'hanzo:ready' } | { type: 'hanzo:navigate'; href: string },
): void {
  if (typeof window === 'undefined' || !isFramed()) return;
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(msg, '*');
    }
  } catch {
    // ignore cross-window post errors
  }
}
