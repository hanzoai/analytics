'use client';
import { IamProvider } from '@hanzo/iam/react';
import { Loading, RouterProvider, ZenProvider } from '@hanzo/react-zen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IntlProvider } from 'react-intl';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useLocale } from '@/components/hooks';
import 'chartjs-adapter-date-fns';

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60,
    },
  },
});

const iamConfig = {
  serverUrl: process.env.NEXT_PUBLIC_IAM_URL || 'https://iam.hanzo.ai',
  clientId: process.env.NEXT_PUBLIC_IAM_CLIENT_ID || 'hanzo-analytics',
  orgName: process.env.NEXT_PUBLIC_IAM_ORG || 'hanzo',
  redirectUri:
    (typeof window !== 'undefined' ? window.location.origin : '') + '/auth/callback',
  scope: 'openid profile email',
};

function MessagesProvider({ children }) {
  const { locale, messages, dir } = useLocale();

  useEffect(() => {
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', locale);
  }, [locale, dir]);

  return (
    <IntlProvider locale={locale} messages={messages[locale]} onError={() => null}>
      {children}
    </IntlProvider>
  );
}

export function Providers({ children }) {
  const router = useRouter();
  // The IAM browser SDK reads sessionStorage at construction, so it must only
  // instantiate in the browser. Defer mounting until after hydration.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  function navigate(url: string) {
    if (shouldUseNativeLink(url)) {
      window.location.href = url;
    } else {
      router.push(url);
    }
  }

  function shouldUseNativeLink(url: string) {
    return url.startsWith('http');
  }

  if (!mounted) {
    return (
      <ZenProvider colorScheme="dark">
        <Loading placement="absolute" />
      </ZenProvider>
    );
  }

  return (
    <IamProvider config={iamConfig}>
      <ZenProvider colorScheme="dark">
        <RouterProvider navigate={navigate}>
          <MessagesProvider>
            <QueryClientProvider client={client}>
              <ErrorBoundary>{children}</ErrorBoundary>
            </QueryClientProvider>
          </MessagesProvider>
        </RouterProvider>
      </ZenProvider>
    </IamProvider>
  );
}
