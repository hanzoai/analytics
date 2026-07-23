import { gzipSync } from 'node:zlib';
import datastore from '@/lib/datastore';
import { uuid } from '@/lib/crypto';
import { DATASTORE, PRISMA, runQuery } from '@/lib/db';
import kafka from '@/lib/kafka';
import prisma from '@/lib/prisma';

export interface SaveRecordingArgs {
  websiteId: string;
  sessionId: string;
  visitId: string;
  chunkIndex: number;
  events: any[];
  eventCount: number;
  startedAt: Date;
  endedAt: Date;
}

export async function saveRecording(args: SaveRecordingArgs) {
  return runQuery({
    [PRISMA]: () => relationalQuery(args),
    [DATASTORE]: () => datastoreQuery(args),
  });
}

async function relationalQuery({
  websiteId,
  sessionId,
  visitId,
  chunkIndex,
  events,
  eventCount,
  startedAt,
  endedAt,
}: SaveRecordingArgs) {
  const compressed = gzipSync(Buffer.from(JSON.stringify(events), 'utf-8'));

  return prisma.client.sessionReplay.create({
    data: {
      id: uuid(),
      websiteId,
      sessionId,
      visitId,
      chunkIndex,
      events: compressed as any,
      eventCount,
      startedAt,
      endedAt,
    },
  });
}

async function datastoreQuery({
  websiteId,
  sessionId,
  visitId,
  chunkIndex,
  events,
  eventCount,
  startedAt,
  endedAt,
}: SaveRecordingArgs) {
  const { insert, getUTCString } = datastore;
  const { sendMessage } = kafka;

  const message = {
    replay_id: uuid(),
    website_id: websiteId,
    session_id: sessionId,
    visit_id: visitId,
    chunk_index: chunkIndex,
    events: JSON.stringify(events),
    event_count: eventCount,
    started_at: getUTCString(startedAt),
    ended_at: getUTCString(endedAt),
  };

  if (kafka.enabled) {
    return sendMessage('session_replay', message);
  }

  return insert('session_replay', [message]);
}
