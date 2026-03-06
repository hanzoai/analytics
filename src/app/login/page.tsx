import type { Metadata } from 'next';
import { LoginPage } from './LoginPage';

// Force dynamic rendering so env vars are read at runtime, not build time
export const dynamic = 'force-dynamic';

export default async function () {
  if (process.env.DISABLE_LOGIN || process.env.CLOUD_MODE) {
    return null;
  }

  const iamUrl = process.env.HANZO_IAM_URL || process.env.NEXT_PUBLIC_IAM_URL || '';
  const iamClientId =
    process.env.HANZO_IAM_CLIENT_ID || process.env.NEXT_PUBLIC_IAM_CLIENT_ID || '';

  return (
    <LoginPage
      branding={{
        name: process.env.NEXT_PUBLIC_APP_NAME || process.env.APP_NAME || 'Analytics',
        iamUrl,
        iamClientId,
        iamProviderName:
          process.env.NEXT_PUBLIC_IAM_PROVIDER_NAME || process.env.IAM_PROVIDER_NAME || '',
        iamEnabled: !!(iamUrl && iamClientId),
      }}
    />
  );
}

export const metadata: Metadata = {
  title: 'Login',
};
