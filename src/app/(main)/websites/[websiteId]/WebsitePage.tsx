'use client';
import { analyticsSource, ProductAnalytics, WebAnalytics } from '@hanzo/dashboard';
import { YStack } from '@hanzo/gui';
import { useIam } from '@hanzo/iam/react';
import { useMemo } from 'react';

/**
 * A website's page is the shared analytics views (@hanzo/dashboard), the same ones
 * a project's page in the platform mounts, over this app's own /v1 API.
 */
export function WebsitePage({ websiteId }: { websiteId: string }) {
  const { sdk } = useIam();
  const source = useMemo(
    () => analyticsSource({ base: process.env.basePath || '', token: () => sdk.getAccessToken() }),
    [sdk],
  );

  return (
    <YStack gap="$6" width="100%">
      <WebAnalytics source={source} website={websiteId} />
      <ProductAnalytics source={source} website={websiteId} />
    </YStack>
  );
}
