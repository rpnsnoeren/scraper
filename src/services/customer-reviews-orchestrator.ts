import { CacheService } from './cache';
import { ScraperService } from './scraper';
import { ReviewDiscoveryService, DiscoveredPlatform } from './review-discovery';
import { getParser } from './review-parsers/index';
import { CustomerReviewsResponse, PlatformReviews } from '../types/customer-reviews';

const PARSER_TIMEOUT = 45_000;
const MAX_CONCURRENT = 3;

export class CustomerReviewsOrchestrator {
  private cache: CacheService;
  private scraper: ScraperService;
  private discovery: ReviewDiscoveryService;

  constructor(cache: CacheService, scraper: ScraperService) {
    this.cache = cache;
    this.scraper = scraper;
    this.discovery = new ReviewDiscoveryService(scraper);
  }

  async scrape(businessName: string, domain?: string): Promise<CustomerReviewsResponse> {
    const cacheKey = `reviews:${businessName.toLowerCase()}:${domain?.toLowerCase() || ''}`;

    // Check cache
    const cached = await this.cache.get<CustomerReviewsResponse>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    // Discover platforms
    console.log(`[CustomerReviews] Discovering review platforms for "${businessName}"...`);
    const discoveredPlatforms = await this.discovery.discover(businessName, domain);
    console.log(`[CustomerReviews] Found ${discoveredPlatforms.length} platforms`);

    if (discoveredPlatforms.length === 0) {
      const emptyResponse: CustomerReviewsResponse = {
        businessName,
        domain,
        platforms: [],
        cached: false,
        scrapedAt: new Date().toISOString(),
      };
      await this.cache.set(cacheKey, emptyResponse);
      return emptyResponse;
    }

    // Parse reviews from each platform with concurrency limit
    const platforms = await this.parseWithConcurrency(discoveredPlatforms, MAX_CONCURRENT);

    const response: CustomerReviewsResponse = {
      businessName,
      domain,
      platforms,
      cached: false,
      scrapedAt: new Date().toISOString(),
    };

    await this.cache.set(cacheKey, response);
    return response;
  }

  private async parseWithConcurrency(
    discovered: DiscoveredPlatform[],
    maxConcurrent: number
  ): Promise<PlatformReviews[]> {
    const results: PlatformReviews[] = [];

    // Process in batches of maxConcurrent
    for (let i = 0; i < discovered.length; i += maxConcurrent) {
      const batch = discovered.slice(i, i + maxConcurrent);

      const batchResults = await Promise.allSettled(
        batch.map((platform) => this.parsePlatformWithTimeout(platform))
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        }
      }
    }

    return results;
  }

  private async parsePlatformWithTimeout(
    discovered: DiscoveredPlatform
  ): Promise<PlatformReviews | null> {
    const parser = getParser(discovered.platform, this.scraper);
    if (!parser) {
      console.warn(`[CustomerReviews] No parser for platform: ${discovered.platform}`);
      return null;
    }

    console.log(`[CustomerReviews] Parsing ${discovered.platform}: ${discovered.url}`);

    try {
      const result = await Promise.race([
        parser.parse(discovered.url),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout na 45s voor ${discovered.platform}`)), PARSER_TIMEOUT)
        ),
      ]);

      return {
        platform: discovered.platform,
        url: discovered.url,
        averageRating: result.averageRating,
        totalReviews: result.totalReviews,
        reviews: result.reviews,
      };
    } catch (error) {
      console.error(`[CustomerReviews] Parser failed for ${discovered.platform}:`, error);
      return null;
    }
  }
}
