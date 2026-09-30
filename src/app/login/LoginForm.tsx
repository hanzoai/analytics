'use client';
import { useIam } from '@hanzo/iam/react';
import { Loading } from '@hanzo/react-zen';
import { SignIn } from '@hanzo/ui/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { BrandingProps } from './LoginPage';

/**
 * IAM's sign-in drawn on this page: the credential posts to this origin's
 * /v1/iam routes, IAM returns a PKCE-bound code, and /auth/callback finishes.
 * SignIn is built from @hanzo/gui components; the app mounts the one GuiProvider
 * (src/app/Providers.tsx).
 */
export function LoginForm({ branding }: { branding: BrandingProps }) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useIam();

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
    <SignIn
      mode="login"
      site={branding.name}
      callbackPath="/auth/callback"
      signupPath="https://hanzo.ai/signup"
      termsPath="https://hanzo.ai/terms"
      privacyPath="https://hanzo.ai/privacy"
    />
  );
}
