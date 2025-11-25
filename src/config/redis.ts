// Redis connection for sessions, caching, and job queues
import RedisLib from 'ioredis';
import { config } from './index.js';

// Fix for ioredis ESM import
const Redis = RedisLib.default || RedisLib;

// Main Redis client for general operations
export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
  retryStrategy(times: number) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  console.log('Redis connected');
});

redis.on('error', (err: Error) => {
  console.error('Redis connection error:', err.message);
});

// Separate Redis client for BullMQ (job queues)
// BullMQ requires a dedicated connection
export const createBullConnection = () => {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
};

// Graceful shutdown
process.on('beforeExit', async () => {
  await redis.quit();
});
