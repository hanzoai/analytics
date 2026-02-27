/**
 * White-label branding configuration.
 *
 * All values are sourced from environment variables so each deployment
 * (or per-org setup) can customize the look without code changes.
 *
 * Server-side values are exposed to the client via NEXT_PUBLIC_ prefix.
 */

export const branding = {
  /** Display name shown in the sidebar, login page, and page titles. */
  name: process.env.NEXT_PUBLIC_APP_NAME || 'Analytics',

  /** Logo SVG path data (viewBox 0 0 67 67). Set to empty string to hide logo. */
  logoSvg: process.env.NEXT_PUBLIC_LOGO_SVG || '',

  /** URL the logo links to. */
  logoHref: process.env.NEXT_PUBLIC_LOGO_HREF || '/',

  /** IAM / OAuth provider name shown on the SSO button (e.g. "Hanzo", "Acme Corp"). */
  iamProviderName: process.env.NEXT_PUBLIC_IAM_PROVIDER_NAME || '',

  /** IAM authorize base URL (e.g. https://hanzo.id). Empty = IAM login disabled. */
  iamUrl: process.env.NEXT_PUBLIC_HANZO_IAM_URL || process.env.NEXT_PUBLIC_IAM_URL || '',

  /** IAM OAuth client ID. */
  iamClientId:
    process.env.NEXT_PUBLIC_HANZO_IAM_CLIENT_ID || process.env.NEXT_PUBLIC_IAM_CLIENT_ID || '',
} as const;

/** Whether IAM single-sign-on is configured. */
export function isIAMEnabled(): boolean {
  return !!(branding.iamUrl && branding.iamClientId);
}
