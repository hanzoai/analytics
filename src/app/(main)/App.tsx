'use client';
import { useIam } from '@hanzo/iam/react';
import { Button, Column, Grid, Heading, Loading, Row, Text } from '@hanzo/react-zen';
import Script from 'next/script';
import { useEffect, useRef } from 'react';
import { MobileNav } from '@/app/(main)/MobileNav';
import { SideNav } from '@/app/(main)/SideNav';
import { useConfig, useLoginQuery, useNavigation } from '@/components/hooks';
import { LAST_TEAM_CONFIG } from '@/lib/constants';
import { isFramed } from '@/lib/embed';
import { leaveForSignin, stashReturnTo } from '@/lib/iam';
import { removeItem, setItem } from '@/lib/storage';
import { UpdateNotice } from './UpdateNotice';

export function App({ children }) {
  const { sdk, isAuthenticated, isLoading: iamLoading } = useIam();
  const leaving = useRef(false);
  const { user, isLoading } = useLoginQuery();
  const config = useConfig();
  const { pathname, teamId } = useNavigation();
  const framed = isFramed();

  useEffect(() => {
    if (teamId) {
      setItem(LAST_TEAM_CONFIG, teamId);
    } else {
      removeItem(LAST_TEAM_CONFIG);
    }
  }, [teamId]);

  // No verified IAM session once the stored one has been read: on a top-level
  // visit, remember the page asked for and sign in on hanzo.ai with this app's
  // own request. Inside an iframe (`hanzo.app/apps/analytics`), never navigate
  // the frame itself to `hanzo.ai/login` (`X-Frame-Options: DENY`).
  useEffect(() => {
    if (iamLoading || isAuthenticated || framed || leaving.current) return;
    leaving.current = true;
    stashReturnTo(window.location.pathname + window.location.search);
    void leaveForSignin(sdk, 'login');
  }, [framed, iamLoading, isAuthenticated, sdk]);

  if (iamLoading) {
    return <Loading placement="absolute" />;
  }

  if (!isAuthenticated) {
    if (!framed) {
      return <Loading placement="absolute" />;
    }
    return (
      <Column
        role="region"
        aria-label="Sign in required"
        alignItems="center"
        justifyContent="center"
        gap="4"
        height="100vh"
        padding="6"
      >
        <Heading>Sign in to Hanzo Analytics</Heading>
        <Text>Sign in with your Hanzo account to view your analytics.</Text>
        <Button
          variant="primary"
          onPress={() => {
            stashReturnTo(window.location.pathname + window.location.search);
            void leaveForSignin(sdk, 'login');
          }}
        >
          Sign in
        </Button>
      </Column>
    );
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
