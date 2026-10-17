import type { Metadata } from 'next';
import { LoginForm } from '../login/LoginForm';

export default async function () {
  if (process.env.DISABLE_LOGIN || process.env.CLOUD_MODE) {
    return null;
  }

  return <LoginForm mode="signup" />;
}

export const metadata: Metadata = {
  title: 'Sign up',
};
