'use client';
import { GuiProvider } from '@hanzo/gui';
import { useIam } from '@hanzo/iam/react';
import { Loading } from '@hanzo/react-zen';
import { SignIn } from '@hanzo/ui/auth';
import { config } from '@hanzo/ui/gui-config';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { BrandingProps } from './LoginPage';

/**
 * IAM's sign-in drawn on this page: the credential posts to this origin's
 * /v1/iam routes, IAM returns a PKCE-bound code, and /auth/callback finishes.
 * SignIn is built from @hanzo/gui components, so it renders inside the Hanzo
 * GuiProvider; the rest of the app keeps its own design system.
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
    <GuiProvider config={config} defaultTheme="dark">
      <SignIn
        mode="login"
        site={branding.name}
        callbackPath="/auth/callback"
        signupPath="https://hanzo.ai/signup"
        termsPath="https://hanzo.ai/terms"
        privacyPath="https://hanzo.ai/privacy"
      />
    </GuiProvider>
  );
}
