'use client';
import { Column } from '@hanzo/react-zen';
import { LoginForm } from './LoginForm';

export interface BrandingProps {
  name: string;
}

export function LoginPage({ branding }: { branding: BrandingProps }) {
  return (
    <Column alignItems="center" height="100vh" backgroundColor="1" paddingTop="12">
      <LoginForm branding={branding} />
    </Column>
  );
}
