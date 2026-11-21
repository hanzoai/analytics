import type { AstSnapshot } from './journeys';

export interface StoredAstSnapshot {
  hostname: string;
  route_template: string;
  viewport: string;
  release: string;
  sections: NonNullable<AstSnapshot['sections']>;
  recorded_at: string;
}

const MAX_ROUTE_BUCKETS = 500;
const MAX_RELEASES_PER_ROUTE = 50;

const store = new Map<string, StoredAstSnapshot[]>();

function bucketKey(hostname: string, routeTemplate: string, viewport: string): string {
  return `${hostname.toLowerCase()}|${routeTemplate}|${viewport || 'desktop'}`;
}

function evictOldestBucket(): void {
  const firstKey = store.keys().next().value;
  if (firstKey !== undefined) store.delete(firstKey);
}

export function saveAstSnapshot(input: {
  hostname: string;
  route_template: string;
  viewport?: string;
  release: string;
  sections?: AstSnapshot['sections'];
}): { stored: StoredAstSnapshot; previous?: StoredAstSnapshot } {
  const viewport = input.viewport || 'desktop';
  const key = bucketKey(input.hostname, input.route_template, viewport);

  let bucket = store.get(key);
  if (!bucket) {
    if (store.size >= MAX_ROUTE_BUCKETS) evictOldestBucket();
    bucket = [];
    store.set(key, bucket);
  } else {
    // Refresh insertion order for LRU eviction
    store.delete(key);
    store.set(key, bucket);
  }

  // Find most recent snapshot from a DIFFERENT release for automatic diffing
  let previous: StoredAstSnapshot | undefined;
  for (let i = bucket.length - 1; i >= 0; i--) {
    if (bucket[i].release !== input.release) {
      previous = bucket[i];
      break;
    }
  }

  const stored: StoredAstSnapshot = {
    hostname: input.hostname,
    route_template: input.route_template,
    viewport,
    release: input.release,
    sections: input.sections ?? [],
    recorded_at: new Date().toISOString(),
  };

  const existingIdx = bucket.findIndex(item => item.release === input.release);
  if (existingIdx >= 0) {
    bucket[existingIdx] = stored;
  } else {
    bucket.push(stored);
    if (bucket.length > MAX_RELEASES_PER_ROUTE) {
      bucket.splice(0, bucket.length - MAX_RELEASES_PER_ROUTE);
    }
  }

  return { stored, previous };
}

export function getAstSnapshot(
  hostname: string,
  routeTemplate: string,
  release: string,
  viewport = 'desktop',
): StoredAstSnapshot | undefined {
  const bucket = store.get(bucketKey(hostname, routeTemplate, viewport));
  return bucket?.find(item => item.release === release);
}

export function listAstReleases(filter?: {
  hostname?: string;
  route_template?: string;
  viewport?: string;
}): Array<{
  hostname: string;
  route_template: string;
  viewport: string;
  release: string;
  sections: number;
  recorded_at: string;
}> {
  const hostFilter = filter?.hostname?.toLowerCase();
  const out: Array<{
    hostname: string;
    route_template: string;
    viewport: string;
    release: string;
    sections: number;
    recorded_at: string;
  }> = [];

  for (const bucket of store.values()) {
    for (const item of bucket) {
      if (hostFilter && item.hostname.toLowerCase() !== hostFilter) continue;
      if (filter?.route_template && item.route_template !== filter.route_template) continue;
      if (filter?.viewport && item.viewport !== filter.viewport) continue;
      out.push({
        hostname: item.hostname,
        route_template: item.route_template,
        viewport: item.viewport,
        release: item.release,
        sections: item.sections.length,
        recorded_at: item.recorded_at,
      });
    }
  }
  return out;
}

export function clearAstSnapshots(): void {
  store.clear();
}
