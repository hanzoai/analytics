'use client';
import { useIam } from '@hanzo/iam/react';
import { Button, Column, Heading, Loading, Text } from '@hanzo/react-zen';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { leaveForSignin, takeReturnTo } from '@/lib/iam';

/**
 * No form is drawn here: Hanzo signs in on hanzo.ai. Once the stored session has
 * settled as nobody, the page leaves with this app's own request (`leaveForSignin`);
 * someone already signed in goes on to the page they asked for. The page a
 * sign-out lands on (`?from=logout`) waits to be asked instead: hanzo.ai keeps its
 * own session, and leaving at once would sign the person straight back in.
 */
export function LoginForm({ mode = 'login' }: { mode?: 'login' | 'signup' }) {
  const router = useRouter();
  const out = useSearchParams().get('from') === 'logout';
  const { sdk, isAuthenticated, isLoading } = useIam();
  const left = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      router.replace(takeReturnTo());
      return;
    }
    if (out || left.current) return;
    left.current = true;
    void leaveForSignin(sdk, mode);
  }, [isAuthenticated, isLoading, mode, out, router, sdk]);

  if (!out || isLoading || isAuthenticated) return <Loading placement="absolute" />;
  return (
    <Column role="region" aria-label="Signed out" alignItems="center" gap="4" paddingTop="12">
      <Heading>You are signed out</Heading>
      <Text>Sign in again on hanzo.ai to come back.</Text>
      <Button variant="primary" onPress={() => void leaveForSignin(sdk, 'login')}>
        Sign in
      </Button>
    </Column>
  );
}
