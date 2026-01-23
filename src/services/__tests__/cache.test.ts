import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheService } from '../cache';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
  });

  it('should return null for cache miss', async () => {
    const result = await cache.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should return cached value for cache hit', async () => {
    const data = { domain: 'test.nl', hasVacancies: true };
    await cache.set('test-key', data, 3600);
    const result = await cache.get('test-key');
    expect(result).toEqual(data);
  });

  it('should generate consistent cache key from domain', () => {
    const key1 = cache.keyFor('example.nl');
    const key2 = cache.keyFor('example.nl');
    const key3 = cache.keyFor('other.nl');
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });
});
