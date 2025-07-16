import Redis from 'ioredis';

export const REDIS = Symbol.for('@hanzo/analytics/redis-client');

export class AnalyticsRedisClient {
  private client: Redis | null = null;
  private connected = false;

  constructor(private url?: string) {
    if (url) {
      this.connect();
    }
  }

  private connect() {
    if (!this.url || this.connected) return;

    try {
      this.client = new Redis(this.url);
      this.connected = true;

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });

      this.client.on('connect', () => {
        console.log('Redis Client Connected');
      });
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    return this.client.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<'OK' | null> {
    if (!this.client) return null;
    if (ttl) {
      return this.client.set(key, value, 'EX', ttl);
    }
    return this.client.set(key, value);
  }

  async del(key: string): Promise<number> {
    if (!this.client) return 0;
    return this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    if (!this.client) return 0;
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.client) return 0;
    return this.client.expire(key, seconds);
  }

  async quit(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
    }
  }
}

export default AnalyticsRedisClient;