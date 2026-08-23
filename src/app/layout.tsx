import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Providers } from './Providers';
import '@hanzo/design/tokens/fonts.css';
import '@hanzo/react-zen/styles.css';
import '@/styles/global.css';
import '@/styles/variables.css';

export default function ({ children }) {
  if (process.env.DISABLE_UI) {
    return (
      <html>
        <body></body>
      </html>
    );
  }

  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#0a0a0a" />
        <meta name="msapplication-TileColor" content="#ffffff" />
        <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
        <meta name="robots" content="noindex,nofollow" />
      </head>
      <body>
        <Suspense>
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}

const appName = process.env.NEXT_PUBLIC_APP_NAME || 'Hanzo Analytics';

export const metadata: Metadata = {
  title: {
    template: `%s | ${appName}`,
    default: appName,
  },
};
