import Redis from 'ioredis';
export const REDIS = Symbol('REDIS');
export function connectRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: false, commandTimeout: 3000 });
}
