'use client';
import { useIam } from '@hanzo/iam/react';
import { Column, Grid, Loading, Row } from '@hanzo/react-zen';
import Script from 'next/script';
import { useEffect, useRef } from 'react';
import { MobileNav } from '@/app/(main)/MobileNav';
import { SideNav } from '@/app/(main)/SideNav';
import { useConfig, useLoginQuery, useNavigation } from '@/components/hooks';
import { LAST_TEAM_CONFIG } from '@/lib/constants';
import { leaveForSignin, stashReturnTo } from '@/lib/iam';
import { removeItem, setItem } from '@/lib/storage';
import { UpdateNotice } from './UpdateNotice';

export function App({ children }) {
  const { sdk, isAuthenticated, isLoading: iamLoading } = useIam();
  const leaving = useRef(false);
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

  // No verified IAM session once the stored one has been read: remember the page
  // asked for, then sign in on hanzo.ai with this app's own request.
  useEffect(() => {
    if (iamLoading || isAuthenticated || leaving.current) return;
    leaving.current = true;
    stashReturnTo(window.location.pathname + window.location.search);
    void leaveForSignin(sdk, 'login');
  }, [iamLoading, isAuthenticated, sdk]);

  // Wait for the IAM SDK to restore any stored session, or for the page to leave.
  if (iamLoading || !isAuthenticated) {
    return <Loading placement="absolute" />;
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
