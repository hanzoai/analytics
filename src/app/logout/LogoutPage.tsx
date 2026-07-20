'use client';
import { useIam } from '@hanzo/iam/react';
import { useEffect } from 'react';
import { setUser } from '@/store/app';

export function LogoutPage() {
  const { logout } = useIam();

  useEffect(() => {
    // Clear the IAM session (local tokens) and the cached user, then land on
    // the login page.
    logout();
    setUser(null);
    window.location.href = `${process.env.basePath || ''}/login`;
  }, [logout]);

  return null;
}
