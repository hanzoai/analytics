import type { Metadata } from 'next';
import { LoginPage } from './LoginPage';

export default async function () {
  if (process.env.DISABLE_LOGIN || process.env.CLOUD_MODE) {
    return null;
  }

  return (
    <LoginPage
      branding={{
        name: process.env.NEXT_PUBLIC_APP_NAME || process.env.APP_NAME || 'Hanzo Analytics',
      }}
    />
  );
}

export const metadata: Metadata = {
  title: 'Login',
};
