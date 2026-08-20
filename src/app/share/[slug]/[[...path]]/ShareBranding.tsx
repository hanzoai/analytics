'use client';
import { Icon, Row, Text } from '@hanzo/react-zen';
import { useShare } from '@/components/hooks';
import { Logo } from '@/components/svg';
import { branding } from '@/lib/branding';

const LOGO_SIZE = { sm: 24, md: 32, lg: 40 };
const TEXT_SIZE = { sm: 'sm', md: 'base', lg: 'lg' } as const;

export function ShareBranding({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const share = useShare();
  // A share page is public, so its fallback is the branding strangers see:
  // this deployment's own name, linking back to this deployment.
  const logoDomain = share?.whiteLabel?.domainName || branding.logoHref;
  const logoName = share?.whiteLabel?.displayName || branding.name;
  const logoImage = share?.whiteLabel?.logoUrl;
  const height = LOGO_SIZE[size];

  return (
    <a href={logoDomain} target="_blank" rel="noopener" style={{ marginLeft: 12 }}>
      <Row alignItems="center" gap>
        {logoImage ? (
          <img src={logoImage} alt={logoName} style={{ height }} />
        ) : (
          <Icon>
            <Logo />
          </Icon>
        )}
        <Text size={TEXT_SIZE[size]} weight="bold">
          {logoName}
        </Text>
      </Row>
    </a>
  );
}
