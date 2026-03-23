/**
 * White-label branding configuration.
 *
 * All values are sourced from environment variables so each deployment
 * (or per-org setup) can customize the look without code changes.
 *
 * IMPORTANT: NEXT_PUBLIC_* vars are inlined at build time in Next.js standalone mode.
 * For runtime configuration, we also check non-prefixed env vars (server-side only).
 * The page.tsx server component passes these values as props to client components.
 */

function env(key: string): string {
  // Try non-prefixed first (runtime), then NEXT_PUBLIC_ (build-time fallback)
  return process.env[key] || process.env[`NEXT_PUBLIC_${key}`] || '';
}

export const branding = {
  /** Display name shown in the sidebar, login page, and page titles. */
  name: env('APP_NAME') || 'Hanzo Analytics',

  /** Logo SVG path data (viewBox 0 0 67 67). Set to empty string to hide logo. */
  logoSvg: env('LOGO_SVG'),

  /** URL the logo links to. */
  logoHref: env('LOGO_HREF') || '/',

  /** IAM / OAuth provider name shown on the SSO button (e.g. "Hanzo", "Acme Corp"). */
  iamProviderName: process.env.NEXT_PUBLIC_IAM_PROVIDER_NAME || process.env.IAM_PROVIDER_NAME || '',

  /** IAM authorize base URL (e.g. https://hanzo.id). Empty = IAM login disabled. */
  iamUrl:
    process.env.HANZO_IAM_URL ||
    process.env.NEXT_PUBLIC_IAM_URL ||
    process.env.NEXT_PUBLIC_HANZO_IAM_URL ||
    '',

  /** IAM OAuth client ID. */
  iamClientId:
    process.env.HANZO_IAM_CLIENT_ID ||
    process.env.NEXT_PUBLIC_IAM_CLIENT_ID ||
    process.env.NEXT_PUBLIC_HANZO_IAM_CLIENT_ID ||
    '',
} as const;

/** Whether IAM single-sign-on is configured. */
export function isIAMEnabled(): boolean {
  return !!(branding.iamUrl && branding.iamClientId);
}
