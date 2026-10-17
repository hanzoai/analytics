'use client';
import { useIam } from '@hanzo/iam/react';
import { Loading } from '@hanzo/react-zen';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { leaveForSignin, takeReturnTo } from '@/lib/iam';

/**
 * No card is drawn here: Hanzo signs in on hanzo.ai. Once the stored session has
 * settled as nobody, the page leaves with this app's own request (`leaveForSignin`);
 * someone already signed in goes on to the page they asked for.
 */
export function LoginForm({ mode = 'login' }: { mode?: 'login' | 'signup' }) {
  const router = useRouter();
  const { sdk, isAuthenticated, isLoading } = useIam();
  const left = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      router.replace(takeReturnTo());
      return;
    }
    if (left.current) return;
    left.current = true;
    void leaveForSignin(sdk, mode);
  }, [isAuthenticated, isLoading, mode, router, sdk]);

  return <Loading placement="absolute" />;
}
