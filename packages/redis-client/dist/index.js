"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsRedisClient = exports.REDIS = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
exports.REDIS = Symbol.for('@hanzo/analytics/redis-client');
class AnalyticsRedisClient {
    constructor(url) {
        this.url = url;
        this.client = null;
        this.connected = false;
        if (url) {
            this.connect();
        }
    }
    connect() {
        if (!this.url || this.connected)
            return;
        try {
            this.client = new ioredis_1.default(this.url);
            this.connected = true;
            this.client.on('error', (err) => {
                console.error('Redis Client Error:', err);
            });
            this.client.on('connect', () => {
                console.log('Redis Client Connected');
            });
        }
        catch (error) {
            console.error('Failed to connect to Redis:', error);
        }
    }
    async get(key) {
        if (!this.client)
            return null;
        return this.client.get(key);
    }
    async set(key, value, ttl) {
        if (!this.client)
            return null;
        if (ttl) {
            return this.client.set(key, value, 'EX', ttl);
        }
        return this.client.set(key, value);
    }
    async del(key) {
        if (!this.client)
            return 0;
        return this.client.del(key);
    }
    async incr(key) {
        if (!this.client)
            return 0;
        return this.client.incr(key);
    }
    async expire(key, seconds) {
        if (!this.client)
            return 0;
        return this.client.expire(key, seconds);
    }
    async quit() {
        if (this.client) {
            await this.client.quit();
            this.connected = false;
        }
    }
}
exports.AnalyticsRedisClient = AnalyticsRedisClient;
exports.default = AnalyticsRedisClient;
