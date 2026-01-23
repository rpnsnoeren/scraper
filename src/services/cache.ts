import { Redis } from 'ioredis';
import { createHash } from 'crypto';

export class CacheService {
  private redis: Redis | null = null;
  private memoryCache: Map<string, { data: unknown; expires: number }> = new Map();
  private ttl = 24 * 60 * 60; // 24 hours

  constructor(redisUrl?: string) {
    if (redisUrl) {
      this.redis = new Redis(redisUrl);
    }
  }

  keyFor(domain: string): string {
    return `vacancy:${createHash('sha256').update(domain.toLowerCase()).digest('hex').slice(0, 16)}`;
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.redis) {
      try {
        const data = await this.redis.get(key);
        return data ? JSON.parse(data) : null;
      } catch {
        return null;
      }
    }

    const cached = this.memoryCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data as T;
    }
    this.memoryCache.delete(key);
    return null;
  }

  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    const expiry = ttl ?? this.ttl;

    if (this.redis) {
      try {
        await this.redis.setex(key, expiry, JSON.stringify(data));
        return;
      } catch {
        // Fall through to memory cache on Redis error
      }
    }
    this.memoryCache.set(key, {
      data,
      expires: Date.now() + expiry * 1000,
    });
  }

  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}
