import { Column, Label } from '@hanzo/react-zen';
import { useLoginQuery, useMessages } from '@/components/hooks';
import { ROLES } from '@/lib/constants';

export function ProfileSettings() {
  const { user } = useLoginQuery();
  const { formatMessage, labels } = useMessages();

  if (!user) {
    return null;
  }

  const { username, role } = user;

  const renderRole = (value: string) => {
    if (value === ROLES.user) {
      return formatMessage(labels.user);
    }
    if (value === ROLES.admin) {
      return formatMessage(labels.admin);
    }
    if (value === ROLES.viewOnly) {
      return formatMessage(labels.viewOnly);
    }

    return formatMessage(labels.unknown);
  };

  return (
    <Column width="400px" gap="6">
      <Column>
        <Label>{formatMessage(labels.username)}</Label>
        {username}
      </Column>
      <Column>
        <Label>{formatMessage(labels.role)}</Label>
        {renderRole(role)}
      </Column>
    </Column>
  );
}
