'use client';
import { Column } from '@hanzo/react-zen';
import { LoginForm } from './LoginForm';

export interface BrandingProps {
  name: string;
  iamUrl: string;
  iamClientId: string;
  iamProviderName: string;
  iamEnabled: boolean;
}

export function LoginPage({ branding }: { branding: BrandingProps }) {
  return (
    <Column alignItems="center" height="100vh" backgroundColor="2" paddingTop="12">
      <LoginForm branding={branding} />
    </Column>
  );
}
