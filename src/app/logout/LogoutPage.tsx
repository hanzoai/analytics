'use client';
import { useSignOut } from '@hanzo/ui/auth';
import { useEffect } from 'react';
import { IAM_API } from '@/lib/iam';
import { setUser } from '@/store/app';

export function LogoutPage() {
  const signOut = useSignOut({
    via: IAM_API,
    to: `${process.env.basePath || ''}/login?from=logout`,
  });

  useEffect(() => {
    // Revoke both tokens at IAM (api.hanzo.ai), clear the session and the
    // cached user, then land on /login?from=logout, which waits to be asked.
    setUser(null);
    void signOut();
  }, [signOut]);

  return null;
}
