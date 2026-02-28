import { UmamiRedisClient as KVClient } from '@hanzo/redis-client';

const REDIS = 'redis';
const enabled = !!(process.env.KV_URL || process.env.REDIS_URL);

function getClient() {
  const redis = new KVClient({ url: process.env.KV_URL || process.env.REDIS_URL });

  if (process.env.NODE_ENV !== 'production') {
    globalThis[REDIS] = redis;
  }

  return redis;
}

const client = globalThis[REDIS] || getClient();

export default { client, enabled };
