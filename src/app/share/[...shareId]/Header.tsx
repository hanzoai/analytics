import { Icon, Row, Text, ThemeButton } from '@hanzo/react-zen';
import { LanguageButton } from '@/components/input/LanguageButton';
import { PreferencesButton } from '@/components/input/PreferencesButton';
import { Logo } from '@/components/svg';
import { branding } from '@/lib/branding';
import { HOMEPAGE_URL } from '@/lib/constants';

export function Header() {
  return (
    <Row as="header" justifyContent="space-between" alignItems="center" paddingY="3">
      <a href={HOMEPAGE_URL} target="_blank" rel="noopener">
        <Row alignItems="center" gap>
          <Icon>
            <Logo />
          </Icon>
          <Text weight="bold">{branding.name}</Text>
        </Row>
      </a>
      <Row alignItems="center" gap>
        <ThemeButton />
        <LanguageButton />
        <PreferencesButton />
      </Row>
    </Row>
  );
}
