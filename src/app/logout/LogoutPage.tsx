'use client';
import { useSignOut } from '@hanzo/ui/auth';
import { useEffect } from 'react';
import { setUser } from '@/store/app';

export function LogoutPage() {
  const signOut = useSignOut({ to: `${process.env.basePath || ''}/login?from=logout` });

  useEffect(() => {
    // Revoke both tokens through this origin's /v1/iam routes, clear the
    // session and the cached user, then land on the login page.
    setUser(null);
    void signOut();
  }, [signOut]);

  return null;
}
