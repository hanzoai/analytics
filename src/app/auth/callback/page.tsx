import { Suspense } from 'react';
import { AuthCallback } from './AuthCallback';

export default function () {
  return (
    <Suspense>
      <AuthCallback />
    </Suspense>
  );
}
