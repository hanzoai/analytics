import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export default async function () {
  if (process.env.DISABLE_LOGIN || process.env.CLOUD_MODE) {
    return null;
  }

  return <LoginForm mode="login" />;
}

export const metadata: Metadata = {
  title: 'Login',
};
