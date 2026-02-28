import { Button, DataColumn, DataTable, Icon, Modal, Row } from '@hanzo/react-zen';
import Link from 'next/link';
import { useState } from 'react';
import { DateDistance } from '@/components/common/DateDistance';
import { LinkButton } from '@/components/common/LinkButton';
import { useLoginQuery, useMessages } from '@/components/hooks';
import { Edit, Trash } from '@/components/icons';
import { ROLES } from '@/lib/constants';
import { UserDeleteForm } from './UserDeleteForm';

export function UsersTable({
  data = [],
  showActions = true,
}: {
  data: any[];
  showActions?: boolean;
}) {
  const { formatMessage, labels } = useMessages();
  const { user: loginUser } = useLoginQuery();
  const [deleteUser, setDeleteUser] = useState(null);

  return (
    <>
      <DataTable data={data}>
        <DataColumn id="username" label={formatMessage(labels.username)} width="2fr">
          {(row: any) => <Link href={`/admin/users/${row.id}`}>{row.username}</Link>}
        </DataColumn>
        <DataColumn id="role" label={formatMessage(labels.role)}>
          {(row: any) =>
            formatMessage(
              labels[Object.keys(ROLES).find(key => ROLES[key] === row.role)] || labels.unknown,
            )
          }
        </DataColumn>
        <DataColumn id="websites" label={formatMessage(labels.websites)}>
          {(row: any) => row._count.websites}
        </DataColumn>
        <DataColumn id="created" label={formatMessage(labels.created)}>
          {(row: any) => <DateDistance date={new Date(row.createdAt)} />}
        </DataColumn>
        {showActions && (
          <DataColumn id="action" align="end" width="100px">
            {(row: any) => {
              const { id } = row;
              return (
                <Row gap alignItems="center">
                  <LinkButton
                    href={`/admin/users/${id}`}
                    variant="quiet"
                    data-test="link-button-edit"
                  >
                    <Icon size="sm">
                      <Edit />
                    </Icon>
                  </LinkButton>
                  <Button
                    variant="quiet"
                    isDisabled={id === loginUser?.id}
                    onPress={() => setDeleteUser(row)}
                    data-test="button-delete"
                  >
                    <Icon size="sm">
                      <Trash />
                    </Icon>
                  </Button>
                </Row>
              );
            }}
          </DataColumn>
        )}
      </DataTable>
      <Modal isOpen={!!deleteUser}>
        <UserDeleteForm
          userId={deleteUser?.id}
          username={deleteUser?.username}
          onClose={() => setDeleteUser(null)}
        />
      </Modal>
    </>
  );
}
