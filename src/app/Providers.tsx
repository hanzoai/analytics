'use client';
import { GuiProvider } from '@hanzo/gui';
import { IamProvider } from '@hanzo/iam/react';
import { Loading, RouterProvider, ZenProvider } from '@hanzo/react-zen';
import { config as gui } from '@hanzo/ui/gui-config';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { IntlProvider } from 'react-intl';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useLocale } from '@/components/hooks';
import {
  applyHostMessage,
  hasStoredIamSession,
  isFramed,
  isTrustedHostOrigin,
  postToHost,
} from '@/lib/embed';
import { iamConfig } from '@/lib/iam';
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

function FrameNavigationReporter() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isFramed()) return;
    const qs = searchParams?.toString();
    const clean = qs
      ? qs
          .split('&')
          .filter(p => p && p !== 'embed=1')
          .join('&')
      : '';
    const href = clean ? `${pathname}?${clean}` : pathname;
    postToHost({ type: 'hanzo:navigate', href });
  }, [pathname, searchParams]);

  return null;
}

export function Providers({ children }) {
  const router = useRouter();
  // The IAM browser SDK reads sessionStorage at construction, so it must only
  // instantiate in the browser. When embedded in a workspace iframe (`?embed=1`),
  // also wait briefly for the host's `hanzo:host` bearer handoff before mounting
  // `IamProvider` so the viewer enters Analytics without a second sign-in.
  const [ready, setReady] = useState(false);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const framed = isFramed();
    let settled = !framed || hasStoredIamSession();
    if (settled) {
      setReady(true);
    }

    const settle = () => {
      if (settled) return;
      settled = true;
      setReady(true);
    };

    const onMessage = (e: MessageEvent) => {
      if (!isTrustedHostOrigin(e.origin)) return;
      const res = applyHostMessage(e.data);
      if (!res.recognized) return;
      if (res.theme) {
        setTheme(res.theme);
      }
      if (!settled) {
        settle();
        return;
      }
      if (res.tokenChanged) {
        setAuthEpoch(n => n + 1);
        void client.invalidateQueries();
      }
    };

    window.addEventListener('message', onMessage);
    if (framed) {
      postToHost({ type: 'hanzo:ready' });
    }

    const timer = !settled ? window.setTimeout(settle, 1200) : null;

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
  }, []);

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

  if (!ready) {
    return (
      <ZenProvider colorScheme={theme}>
        <Loading placement="absolute" />
      </ZenProvider>
    );
  }

  return (
    <IamProvider key={authEpoch} config={iamConfig(window.location.origin)}>
      {/* @hanzo/gui draws the sign-in and the shared analytics views; the rest of
          the app keeps react-zen. One provider for both, here. */}
      <GuiProvider config={gui} defaultTheme={theme}>
        <ZenProvider colorScheme={theme}>
          <RouterProvider navigate={navigate}>
            <MessagesProvider>
              <QueryClientProvider client={client}>
                <Suspense fallback={null}>
                  <FrameNavigationReporter />
                </Suspense>
                <ErrorBoundary>{children}</ErrorBoundary>
              </QueryClientProvider>
            </MessagesProvider>
          </RouterProvider>
        </ZenProvider>
      </GuiProvider>
    </IamProvider>
  );
}
