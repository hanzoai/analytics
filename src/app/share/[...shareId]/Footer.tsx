import { Row, Text } from '@hanzo/react-zen';
import { branding } from '@/lib/branding';
import { CURRENT_VERSION, HOMEPAGE_URL } from '@/lib/constants';

export function Footer() {
  return (
    <Row as="footer" paddingY="6" justifyContent="flex-end">
      <a href={HOMEPAGE_URL} target="_blank">
        <Text weight="bold">{branding.name}</Text> {`v${CURRENT_VERSION}`}
      </a>
    </Row>
  );
}
