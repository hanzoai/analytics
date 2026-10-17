'use client';
import { useIam } from '@hanzo/iam/react';
import { Loading } from '@hanzo/react-zen';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { takeReturnTo } from '@/lib/iam';

/**
 * OAuth/OIDC callback: completes the PKCE token exchange (the @hanzo/iam SDK
 * reads code + state + verifier from the URL/storage), then lands on the page
 * that was asked for before sign-in. On failure, returns to /login, which signs
 * in on hanzo.ai again.
 */
export function AuthCallback() {
  const router = useRouter();
  const { handleCallback } = useIam();

  useEffect(() => {
    let cancelled = false;

    handleCallback()
      .then(() => {
        if (!cancelled) router.replace(takeReturnTo());
      })
      .catch(() => {
        if (!cancelled) router.replace('/login');
      });

    return () => {
      cancelled = true;
    };
  }, [handleCallback, router]);

  return <Loading placement="absolute" />;
}
