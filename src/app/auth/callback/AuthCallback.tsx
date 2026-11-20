'use client';
import { useIam } from '@hanzo/iam/react';
import { Loading } from '@hanzo/react-zen';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { buildAuthCallbackOutcome } from '@/lib/auth-telemetry';
import { takeReturnTo } from '@/lib/iam';

function emitAuthCallbackOutcome(
  outcome: 'completed' | 'failed',
  startedAt: number,
  error?: unknown,
) {
  if (typeof window === 'undefined') return;
  try {
    const errorCode =
      outcome === 'failed'
        ? error instanceof Error && error.name
          ? error.name
          : 'oauth_callback_failed'
        : null;

    const telemetry = buildAuthCallbackOutcome({
      hostname: window.location.hostname,
      release: process.env.NEXT_PUBLIC_APP_VERSION || 'unknown',
      viewportWidth: window.innerWidth,
      userAgent: window.navigator?.userAgent,
      outcome,
      latency_ms: Date.now() - startedAt,
      error_code: errorCode,
    });

    const tracker = (window as any).hanzo;
    if (typeof tracker?.track === 'function') {
      tracker.track(telemetry.event, telemetry.payload);
    }
  } catch {
    // Operational telemetry must never block auth redirect
  }
}

/**
 * OAuth/OIDC callback: completes the PKCE token exchange (the @hanzo/iam SDK
 * reads code + state + verifier from the URL/storage), then lands on the page
 * that was asked for before sign-in. On failure, returns to /login, which signs
 * in on hanzo.ai again.
 *
 * Strictly emits auth operational telemetry (`auth_callback_outcome`) — never
 * UX replay or heatmap capture.
 */
export function AuthCallback() {
  const router = useRouter();
  const { handleCallback } = useIam();

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    handleCallback()
      .then(() => {
        emitAuthCallbackOutcome('completed', startedAt);
        if (!cancelled) router.replace(takeReturnTo());
      })
      .catch(err => {
        emitAuthCallbackOutcome('failed', startedAt, err);
        if (!cancelled) router.replace('/login');
      });

    return () => {
      cancelled = true;
    };
  }, [handleCallback, router]);

  return <Loading placement="absolute" />;
}
