import { z } from 'zod';
import {
  classifyDeviceClass,
  DEVICE_CLASSES,
  type DeviceClass,
  FUNNEL_OUTCOMES,
  type FunnelOutcome,
  normalizeHostname,
} from './funnel';

export const AUTH_CALLBACK_OUTCOME_EVENT = 'auth_callback_outcome' as const;
export const AUTH_CALLBACK_CANONICAL_ROUTE = '/auth/callback' as const;

export const authCallbackOutcomeSchema = z.object({
  hostname: z.string().min(1).max(255),
  route: z.literal(AUTH_CALLBACK_CANONICAL_ROUTE),
  release: z.string().min(1).max(128),
  device_class: z.enum(DEVICE_CLASSES),
  outcome: z.enum(FUNNEL_OUTCOMES),
  latency_ms: z.number().finite().nonnegative(),
  error_code: z.string().min(1).max(128).nullable(),
});

export type AuthCallbackOutcomePayload = z.infer<typeof authCallbackOutcomeSchema>;

export interface AuthCallbackTelemetryEvent {
  event: typeof AUTH_CALLBACK_OUTCOME_EVENT;
  channel: 'auth_operational';
  ux_capture_eligible: false;
  payload: AuthCallbackOutcomePayload;
}

export interface BuildAuthCallbackOutcomeInput {
  hostname: string;
  release?: string | null;
  device_class?: DeviceClass;
  viewportWidth?: number;
  userAgent?: string;
  outcome: FunnelOutcome;
  latency_ms: number;
  error_code?: string | null;
}

/**
 * Builds an auth operational telemetry event for `/auth/callback`.
 * Strictly routes to `auth_operational` — NEVER as a UX heatmap or replay design ticket.
 */
export function buildAuthCallbackOutcome(
  input: BuildAuthCallbackOutcomeInput,
): AuthCallbackTelemetryEvent {
  const sanitizedErrorCode =
    input.outcome === 'completed' || input.outcome === 'started'
      ? null
      : input.error_code?.trim() || 'auth_callback_error';

  const payload = authCallbackOutcomeSchema.parse({
    hostname: normalizeHostname(input.hostname),
    route: AUTH_CALLBACK_CANONICAL_ROUTE,
    release: (input.release || 'unknown').trim() || 'unknown',
    device_class:
      input.device_class ??
      classifyDeviceClass({
        width: input.viewportWidth,
        userAgent: input.userAgent,
      }),
    outcome: input.outcome,
    latency_ms: Math.max(0, Math.round(Number(input.latency_ms) || 0)),
    error_code: sanitizedErrorCode,
  });

  return {
    event: AUTH_CALLBACK_OUTCOME_EVENT,
    channel: 'auth_operational',
    ux_capture_eligible: false,
    payload,
  };
}
