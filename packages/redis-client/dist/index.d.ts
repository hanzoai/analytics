export declare const REDIS: unique symbol;
export declare class AnalyticsRedisClient {
    private url?;
    private client;
    private connected;
    constructor(url?: string | undefined);
    private connect;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttl?: number): Promise<'OK' | null>;
    del(key: string): Promise<number>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    quit(): Promise<void>;
}
export default AnalyticsRedisClient;
