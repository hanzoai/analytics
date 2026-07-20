'use client';
import { useIam } from '@hanzo/iam/react';
import { Button, Column, Heading, Icon, Loading } from '@hanzo/react-zen';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Logo } from '@/components/svg';
import type { BrandingProps } from './LoginPage';

export function LoginForm({ branding }: { branding: BrandingProps }) {
  const router = useRouter();
  const { login, isAuthenticated, isLoading } = useIam();

  // Already signed in — bounce to the dashboard.
  useEffect(() => {
    if (isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  if (isLoading || isAuthenticated) {
    return <Loading placement="absolute" />;
  }

  return (
    <Column justifyContent="center" alignItems="center" gap="6">
      <Icon size="lg">
        <Logo />
      </Icon>
      <Heading>{branding.name}</Heading>

      <Column gap="4" style={{ width: '100%', maxWidth: 320 }}>
        <Button
          variant="primary"
          data-test="button-login"
          onPress={() => login()}
          style={{ width: '100%' }}
        >
          Log in with Hanzo
        </Button>
      </Column>
    </Column>
  );
}
