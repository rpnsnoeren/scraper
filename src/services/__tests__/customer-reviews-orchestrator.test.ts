import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomerReviewsOrchestrator } from '../customer-reviews-orchestrator';
import { CacheService } from '../cache';
import { ScraperService } from '../scraper';
import { CustomerReviewsResponse } from '../../types/customer-reviews';

// Mock dependencies
const mockDiscover = vi.fn().mockResolvedValue([]);

vi.mock('../review-discovery', () => ({
  ReviewDiscoveryService: class {
    discover = mockDiscover;
  },
}));

const mockGetParser = vi.fn().mockReturnValue(null);

vi.mock('../review-parsers/index', () => ({
  getParser: (...args: unknown[]) => mockGetParser(...args),
}));

describe('CustomerReviewsOrchestrator', () => {
  let orchestrator: CustomerReviewsOrchestrator;
  let cache: CacheService;
  let scraper: ScraperService;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new CacheService();
    scraper = {} as ScraperService;
    orchestrator = new CustomerReviewsOrchestrator(cache, scraper);
  });

  it('should return cached result with cached: true', async () => {
    const cachedData: CustomerReviewsResponse = {
      businessName: 'Test BV',
      domain: 'test.nl',
      platforms: [],
      cached: false,
      scrapedAt: '2026-04-03T00:00:00.000Z',
    };

    vi.spyOn(cache, 'get').mockResolvedValue(cachedData);

    const result = await orchestrator.scrape('Test BV', 'test.nl');

    expect(result.cached).toBe(true);
    expect(result.businessName).toBe('Test BV');
    expect(cache.get).toHaveBeenCalledWith('reviews:test bv:test.nl');
  });

  it('should return empty platforms when discovery finds nothing', async () => {
    vi.spyOn(cache, 'get').mockResolvedValue(null);
    vi.spyOn(cache, 'set').mockResolvedValue();
    mockDiscover.mockResolvedValue([]);

    const result = await orchestrator.scrape('Onbekend Bedrijf');

    expect(result.platforms).toEqual([]);
    expect(result.cached).toBe(false);
    expect(result.businessName).toBe('Onbekend Bedrijf');
    expect(cache.set).toHaveBeenCalled();
  });

  it('should call parser for discovered platforms', async () => {
    vi.spyOn(cache, 'get').mockResolvedValue(null);
    vi.spyOn(cache, 'set').mockResolvedValue();

    mockDiscover.mockResolvedValue([
      { platform: 'trustpilot', url: 'https://www.trustpilot.com/review/test.nl' },
    ]);

    const mockParser = {
      parse: vi.fn().mockResolvedValue({
        averageRating: 4.5,
        totalReviews: 100,
        reviews: [{ text: 'Geweldig!', rating: 5, author: 'Jan' }],
      }),
    };
    mockGetParser.mockReturnValue(mockParser);

    const result = await orchestrator.scrape('Test BV', 'test.nl');

    expect(result.platforms).toHaveLength(1);
    expect(result.platforms[0].platform).toBe('trustpilot');
    expect(result.platforms[0].averageRating).toBe(4.5);
    expect(result.platforms[0].reviews).toHaveLength(1);
    expect(mockParser.parse).toHaveBeenCalledWith('https://www.trustpilot.com/review/test.nl');
  });

  it('should skip platforms when parser fails', async () => {
    vi.spyOn(cache, 'get').mockResolvedValue(null);
    vi.spyOn(cache, 'set').mockResolvedValue();

    mockDiscover.mockResolvedValue([
      { platform: 'trustpilot', url: 'https://www.trustpilot.com/review/test.nl' },
      { platform: 'google', url: 'https://www.google.com/maps/place/test' },
    ]);

    const failingParser = { parse: vi.fn().mockRejectedValue(new Error('Parse error')) };
    const succeedingParser = {
      parse: vi.fn().mockResolvedValue({
        averageRating: 4.0,
        totalReviews: 50,
        reviews: [{ text: 'Goed', rating: 4 }],
      }),
    };

    mockGetParser
      .mockReturnValueOnce(failingParser)
      .mockReturnValueOnce(succeedingParser);

    const result = await orchestrator.scrape('Test BV', 'test.nl');

    // Only the successful parser result should be included
    expect(result.platforms).toHaveLength(1);
    expect(result.platforms[0].platform).toBe('google');
    expect(result.cached).toBe(false);
  });

  it('should use correct cache key with domain', async () => {
    vi.spyOn(cache, 'get').mockResolvedValue(null);
    vi.spyOn(cache, 'set').mockResolvedValue();

    orchestrator = new CustomerReviewsOrchestrator(cache, scraper);
    await orchestrator.scrape('My Business', 'Example.COM');

    expect(cache.get).toHaveBeenCalledWith('reviews:my business:example.com');
  });

  it('should use correct cache key without domain', async () => {
    vi.spyOn(cache, 'get').mockResolvedValue(null);
    vi.spyOn(cache, 'set').mockResolvedValue();

    orchestrator = new CustomerReviewsOrchestrator(cache, scraper);
    await orchestrator.scrape('My Business');

    expect(cache.get).toHaveBeenCalledWith('reviews:my business:');
  });
});
