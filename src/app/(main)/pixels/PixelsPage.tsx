'use client';
import { Column, DataColumn, DataTable, Loading, Row, Text } from '@hanzo/react-zen';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { CopyButton } from '@/components/common/CopyButton';
import { PageBody } from '@/components/common/PageBody';
import { PageHeader } from '@/components/common/PageHeader';
import { Panel } from '@/components/common/Panel';
import { useApi, useMessages, useNavigation } from '@/components/hooks';

interface ProjectPixel {
  websiteId: string;
  slug: string;
  name: string;
  liveUrl: string;
  pixel: string | null;
}

/** The image a page embeds for its site's default pixel. */
function snippet(pixel: string) {
  return `<img src="${pixel}" alt="" width="1" height="1" style="position:absolute" referrerpolicy="no-referrer-when-downgrade">`;
}

/**
 * Every project of the org has one default pixel, served by the one ingest
 * (api.hanzo.ai/v1/event/pixel/<key>.gif). This page lists them; reading it also
 * syncs the org's websites from cloud's projects.
 */
export function PixelsPage() {
  const { formatMessage, labels } = useMessages();
  const { renderUrl } = useNavigation();
  const { get } = useApi();
  const { data, isLoading, error } = useQuery<ProjectPixel[]>({
    queryKey: ['projects'],
    queryFn: () => get('/projects'),
  });

  return (
    <PageBody>
      <Column gap="6" margin="2">
        <PageHeader
          title={formatMessage(labels.pixels)}
          description="One pixel per project, from its publishable key. Paste the image where a page runs no script."
        />
        <Panel>
          {isLoading ? (
            <Loading placement="absolute" />
          ) : error ? (
            <Text>{String((error as Error)?.message || error)}</Text>
          ) : (
            <DataTable data={data ?? []}>
              <DataColumn id="name" label={formatMessage(labels.name)}>
                {(row: ProjectPixel) => (
                  <Link href={renderUrl(`/websites/${row.websiteId}`)}>{row.name}</Link>
                )}
              </DataColumn>
              <DataColumn id="pixel" label="Pixel">
                {(row: ProjectPixel) =>
                  row.pixel ? (
                    <Row alignItems="center" gap="2">
                      <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{row.pixel}</code>
                      <CopyButton value={snippet(row.pixel)} label="Copy the image tag" />
                    </Row>
                  ) : (
                    <Text color="muted">no key</Text>
                  )
                }
              </DataColumn>
            </DataTable>
          )}
        </Panel>
      </Column>
    </PageBody>
  );
}
