'use client';
import { Loading } from '@hanzo/react-zen';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { setClientAuthToken } from '@/lib/client';

export function SSOPage() {
  const router = useRouter();
  const search = useSearchParams();
  const url = search.get('url');
  const token = search.get('token');

  useEffect(() => {
    if (url && token) {
      setClientAuthToken(token);

      // Validate redirect target is a relative path (prevent open redirect)
      const safeUrl = url.startsWith('/') && !url.startsWith('//') ? url : '/';
      router.push(safeUrl);
    }
  }, [router, url, token]);

  return <Loading placement="absolute" />;
}
