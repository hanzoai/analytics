import { z } from 'zod';
import { extractPathname } from './privacy';

export const DEVICE_CLASSES = ['mobile', 'tablet', 'desktop'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

export const FUNNEL_OUTCOMES = ['started', 'completed', 'canceled', 'failed'] as const;
export type FunnelOutcome = (typeof FUNNEL_OUTCOMES)[number];

export const CONFIRMED_PAYMENT_EVENT_NAME = 'checkout_completed';

export const TRUSTED_PAYMENT_CONFIRMATION_SOURCES = [
  'server',
  'webhook',
  's2s',
  'stripe_webhook',
  'commerce_webhook',
] as const;
export type PaymentConfirmationSource = (typeof TRUSTED_PAYMENT_CONFIRMATION_SOURCES)[number];

const UUID_SEGMENT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT_RE = /^\d+$/;
const LONG_HEX_SEGMENT_RE = /^[0-9a-f]{16,}$/i;
const OPAQUE_ID_SEGMENT_RE =
  /^(?:pi|cs|ch|pm|cus|sub|sess|ord|inv|tok|pay|tx|usr|org|prj)_[a-zA-Z0-9_-]{4,}$/i;

export function normalizeHostname(rawHostname?: string | null): string {
  if (!rawHostname) return 'unknown';
  const trimmed = rawHostname.trim().toLowerCase();
  if (!trimmed) return 'unknown';
  try {
    if (trimmed.includes('://')) {
      return new URL(trimmed).hostname.toLowerCase();
    }
    return trimmed.replace(/:\d+$/, '').replace(/^www\./, '');
  } catch {
    return trimmed.replace(/:\d+$/, '').replace(/^www\./, '');
  }
}

/**
 * Normalizes a raw URL or path into a bounded, low-cardinality route template.
 * Examples:
 *   /pay/confirm/card?session=abc  -> /pay/confirm/:method
 *   /pay/confirm/apple-pay         -> /pay/confirm/:method
 *   /dev/my-project                -> /dev/:project
 *   /dev/my-project/settings       -> /dev/:project/settings
 *   /projects/acme-123/runs/456    -> /projects/:project/runs/:id
 *   /auth/callback?code=123        -> /auth/callback
 */
export function normalizeRouteTemplate(rawUrlOrPath?: string | null): string {
  const pathname = extractPathname(rawUrlOrPath);
  if (pathname === '/') return '/';

  const segments = pathname.split('/').filter(Boolean);
  const normalized: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const lower = seg.toLowerCase();
    const prev = i > 0 ? segments[i - 1].toLowerCase() : '';
    const prev2 = i > 1 ? segments[i - 2].toLowerCase() : '';

    // Preserve already-parameterized segments like :method or :project
    if (seg.startsWith(':')) {
      normalized.push(seg);
      continue;
    }

    // Preserve static callback paths verbatim
    if ((prev === 'auth' || prev === 'oauth' || prev === 'login') && lower === 'callback') {
      normalized.push('callback');
      continue;
    }

    // /pay/confirm/:method
    if (prev2 === 'pay' && prev === 'confirm') {
      normalized.push(':method');
      continue;
    }

    // /pay/card/:id and /checkout/payment/:id
    if ((prev2 === 'pay' && prev === 'card') || (prev2 === 'checkout' && prev === 'payment')) {
      normalized.push(':id');
      continue;
    }

    // /dev/:project and /projects/:project
    if ((prev === 'dev' || prev === 'projects') && !['new', 'create', 'settings'].includes(lower)) {
      normalized.push(':project');
      continue;
    }

    // /org/:org, /orgs/:org, /team/:team, /teams/:team
    if ((prev === 'org' || prev === 'orgs') && !['new', 'create'].includes(lower)) {
      normalized.push(':org');
      continue;
    }
    if ((prev === 'team' || prev === 'teams') && !['new', 'create'].includes(lower)) {
      normalized.push(':team');
      continue;
    }

    if (
      UUID_SEGMENT_RE.test(seg) ||
      NUMERIC_SEGMENT_RE.test(seg) ||
      LONG_HEX_SEGMENT_RE.test(seg) ||
      OPAQUE_ID_SEGMENT_RE.test(seg)
    ) {
      normalized.push(':id');
      continue;
    }

    normalized.push(seg);
  }

  return `/${normalized.join('/')}`;
}

export function classifyDeviceClass(input: {
  width?: number | null;
  device?: string | null;
  userAgent?: string | null;
}): DeviceClass {
  if (typeof input.width === 'number' && Number.isFinite(input.width) && input.width > 0) {
    if (input.width < 768) return 'mobile';
    if (input.width < 1024) return 'tablet';
    return 'desktop';
  }

  const device = (input.device || '').toLowerCase();
  if (device === 'mobile' || device === 'phone') return 'mobile';
  if (device === 'tablet' || device === 'ipad') return 'tablet';
  if (device === 'desktop' || device === 'laptop') return 'desktop';

  const ua = (input.userAgent || '').toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) {
    return 'tablet';
  }
  if (/iphone|ipod|android.*mobile|blackberry|iemobile|opera mini|mobile/i.test(ua)) {
    return 'mobile';
  }

  return 'desktop';
}

export const funnelStepEventSchema = z.object({
  hostname: z.string().min(1).max(255),
  route: z.string().min(1).max(500).startsWith('/'),
  release: z.string().min(1).max(128),
  device_class: z.enum(DEVICE_CLASSES),
  outcome: z.enum(FUNNEL_OUTCOMES),
  step: z.string().min(1).max(100).optional(),
  hz_aid: z.string().min(1).max(128).optional(),
  hz_sid: z.string().min(1).max(128).optional(),
  visitor_id: z.string().min(1).max(128).optional(),
  confirmed_by: z.enum(['server', 'client', 'client_redirect', 'client_unverified']).optional(),
  confirmation_source: z.string().max(64).optional(),
  revenue: z.number().nonnegative().optional(),
  currency: z.string().min(3).max(10).optional(),
});

export type FunnelStepEvent = z.infer<typeof funnelStepEventSchema>;

export interface BuildFunnelStepInput {
  hostname: string;
  route: string;
  release?: string | null;
  device_class?: DeviceClass;
  viewportWidth?: number;
  userAgent?: string;
  device?: string;
  outcome: FunnelOutcome;
  step?: string;
  hz_aid?: string;
  hz_sid?: string;
  visitor_id?: string;
  confirmed_by?: 'server' | 'client' | 'client_redirect' | 'client_unverified';
  confirmation_source?: string;
  revenue?: number;
  currency?: string;
}

export function buildFunnelStepEvent(input: BuildFunnelStepInput): FunnelStepEvent {
  const payload: FunnelStepEvent = {
    hostname: normalizeHostname(input.hostname),
    route: normalizeRouteTemplate(input.route),
    release: (input.release || 'unknown').trim() || 'unknown',
    device_class:
      input.device_class ??
      classifyDeviceClass({
        width: input.viewportWidth,
        device: input.device,
        userAgent: input.userAgent,
      }),
    outcome: input.outcome,
    ...(input.step ? { step: input.step } : {}),
    ...(input.hz_aid ? { hz_aid: input.hz_aid } : {}),
    ...(input.hz_sid ? { hz_sid: input.hz_sid } : {}),
    ...(input.visitor_id ? { visitor_id: input.visitor_id } : {}),
    ...(input.confirmed_by ? { confirmed_by: input.confirmed_by } : {}),
    ...(input.confirmation_source ? { confirmation_source: input.confirmation_source } : {}),
    ...(typeof input.revenue === 'number' ? { revenue: input.revenue } : {}),
    ...(input.currency ? { currency: input.currency.toUpperCase() } : {}),
  };

  return funnelStepEventSchema.parse(payload);
}

export interface ServerPaymentVerificationOptions {
  requireServerAuth?: boolean;
  isServerAuthenticated?: boolean;
}

/**
 * Payment success metrics MUST count ONLY confirmed server-side events
 * (`checkout_completed` with `confirmed_by: 'server'` / S2S webhook),
 * NEVER client redirects alone.
 */
export function isConfirmedServerPaymentEvent(
  eventName?: string | null,
  eventData?: Record<string, any> | null,
  options?: ServerPaymentVerificationOptions,
): boolean {
  if (!eventData || typeof eventData !== 'object') {
    return false;
  }

  if (options?.requireServerAuth && !options.isServerAuthenticated) {
    return false;
  }

  const normalizedName = (eventName || '').trim().toLowerCase();
  if (normalizedName !== CONFIRMED_PAYMENT_EVENT_NAME) {
    return false;
  }

  if (eventData.confirmed_by !== 'server') {
    return false;
  }

  const source = typeof eventData.source === 'string' ? eventData.source.toLowerCase() : '';
  if (source === 'client' || source === 'client_redirect' || source === 'redirect') {
    return false;
  }

  if (typeof eventData.confirmation_source === 'string') {
    const confirmationSource = eventData.confirmation_source.toLowerCase();
    if (
      !TRUSTED_PAYMENT_CONFIRMATION_SOURCES.includes(
        confirmationSource as PaymentConfirmationSource,
      )
    ) {
      return false;
    }
  }

  if (eventData.outcome !== undefined && eventData.outcome !== 'completed') {
    return false;
  }

  return true;
}

export interface PaymentMetricEvent {
  eventName: string;
  eventData?: Record<string, any> | null;
  visitorId?: string;
}

export interface ConfirmedPaymentMetrics {
  confirmedCount: number;
  rejectedUnconfirmedCount: number;
  confirmedVisitorIds: string[];
  revenueByCurrency: Record<string, number>;
}

export function computeConfirmedPaymentMetrics(
  events: PaymentMetricEvent[],
): ConfirmedPaymentMetrics {
  let confirmedCount = 0;
  let rejectedUnconfirmedCount = 0;
  const visitorSet = new Set<string>();
  const revenueByCurrency: Record<string, number> = {};

  for (const ev of events) {
    const isPaymentCandidate =
      ev.eventName === CONFIRMED_PAYMENT_EVENT_NAME ||
      ev.eventName === 'checkout_redirect_return' ||
      ev.eventName === 'payment_success' ||
      (ev.eventData && Number(ev.eventData.revenue) > 0);

    if (!isPaymentCandidate) continue;

    if (isConfirmedServerPaymentEvent(ev.eventName, ev.eventData)) {
      confirmedCount += 1;
      const vid = ev.visitorId || ev.eventData?.visitor_id || ev.eventData?.hz_aid || undefined;
      if (vid) visitorSet.add(String(vid));

      const rev = Number(ev.eventData?.revenue);
      const curr =
        typeof ev.eventData?.currency === 'string' ? ev.eventData.currency.toUpperCase() : '';
      if (Number.isFinite(rev) && rev > 0 && curr) {
        revenueByCurrency[curr] = (revenueByCurrency[curr] || 0) + rev;
      }
    } else {
      rejectedUnconfirmedCount += 1;
    }
  }

  return {
    confirmedCount,
    rejectedUnconfirmedCount,
    confirmedVisitorIds: Array.from(visitorSet),
    revenueByCurrency,
  };
}

/**
 * Verifies whether an incoming HTTP request is an authenticated server-to-server (S2S)
 * webhook/backend call permitted to assert `confirmed_by: 'server'`.
 */
export function isTrustedServerEventRequest(request: Request): boolean {
  const configuredSecret = process.env.ANALYTICS_S2S_SECRET || process.env.COMMERCE_TOKEN;
  const s2sHeader =
    request.headers.get('x-hanzo-s2s-secret') ||
    request.headers.get('x-commerce-webhook-secret') ||
    '';
  const authHeader = request.headers.get('authorization') || '';
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (configuredSecret) {
    return s2sHeader === configuredSecret || bearerToken === configuredSecret;
  }

  // When no secret env is configured, never trust browser-originated requests
  const hasBrowserOrigin = Boolean(
    request.headers.get('origin') ||
      request.headers.get('sec-fetch-mode') ||
      request.headers.get('sec-fetch-site'),
  );
  return !hasBrowserOrigin && Boolean(s2sHeader || bearerToken);
}

/**
 * Strips/downgrades forged `confirmed_by: 'server'` claims on unauthenticated client requests.
 */
export function enforceServerPaymentTrustBoundary(
  eventName: string | undefined,
  eventData: Record<string, any> | undefined,
  isServerAuthenticated: boolean,
): Record<string, any> | undefined {
  if (!eventData || typeof eventData !== 'object') {
    return eventData;
  }

  if (
    eventData.confirmed_by === 'server' &&
    !isServerAuthenticated &&
    (eventName === CONFIRMED_PAYMENT_EVENT_NAME || Number(eventData.revenue) > 0)
  ) {
    return {
      ...eventData,
      confirmed_by: 'client_unverified',
    };
  }

  return eventData;
}
