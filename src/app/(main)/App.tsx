'use client';
import { useIam } from '@hanzo/iam/react';
import { Column, Grid, Loading, Row } from '@hanzo/react-zen';
import Script from 'next/script';
import { useEffect } from 'react';
import { MobileNav } from '@/app/(main)/MobileNav';
import { SideNav } from '@/app/(main)/SideNav';
import { useConfig, useLoginQuery, useNavigation } from '@/components/hooks';
import { LAST_TEAM_CONFIG } from '@/lib/constants';
import { removeItem, setItem } from '@/lib/storage';
import { UpdateNotice } from './UpdateNotice';

export function App({ children }) {
  const { isAuthenticated, isLoading: iamLoading } = useIam();
  const { user, isLoading } = useLoginQuery();
  const config = useConfig();
  const { pathname, teamId } = useNavigation();

  useEffect(() => {
    if (teamId) {
      setItem(LAST_TEAM_CONFIG, teamId);
    } else {
      removeItem(LAST_TEAM_CONFIG);
    }
  }, [teamId]);

  // Wait for the IAM SDK to restore any stored session before deciding.
  if (iamLoading) {
    return <Loading placement="absolute" />;
  }

  // No verified IAM session — send the user to the single login path.
  if (!isAuthenticated) {
    window.location.href = config?.cloudMode
      ? `${process.env.cloudUrl}/login`
      : `${process.env.basePath || ''}/login`;
    return null;
  }

  if (isLoading || !config) {
    return <Loading placement="absolute" />;
  }

  if (!user || !config) {
    return null;
  }

  return (
    <Grid
      columns={{ xs: '1fr', lg: 'auto 1fr' }}
      rows={{ xs: 'auto 1fr', lg: '1fr' }}
      height={{ xs: 'auto', lg: '100vh' }}
      width="100%"
    >
      <Row display={{ xs: 'flex', lg: 'none' }} alignItems="center" gap padding="3">
        <MobileNav />
      </Row>
      <Column display={{ xs: 'none', lg: 'flex' }}>
        <SideNav />
      </Column>
      <Column alignItems="center" overflowY="auto" overflowX="hidden" position="relative">
        {children}
      </Column>
      <UpdateNotice user={user} config={config} />
      {process.env.NODE_ENV === 'production' && !pathname.includes('/share/') && (
        <Script src={`${process.env.basePath || ''}/telemetry.js`} />
      )}
    </Grid>
  );
}
