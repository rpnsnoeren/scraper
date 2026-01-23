// src/services/orchestrator.ts
import { CacheService } from './cache';
import { ScraperService } from './scraper';
import { DiscoveryService } from './discovery';
import { AIExtractor } from './ai-extractor';
import { parseWithPlatform } from './platforms';
import { ScrapeResponse } from '../types/vacancy';

export class Orchestrator {
  private cache: CacheService;
  private scraper: ScraperService;
  private discovery: DiscoveryService;
  private aiExtractor: AIExtractor;

  constructor(config: { redisUrl?: string; anthropicApiKey: string }) {
    this.cache = new CacheService(config.redisUrl);
    this.scraper = new ScraperService();
    this.discovery = new DiscoveryService(this.scraper);
    this.aiExtractor = new AIExtractor(config.anthropicApiKey);
  }

  async scrape(domain: string): Promise<ScrapeResponse> {
    const cacheKey = this.cache.keyFor(domain);

    // Check cache
    const cached = await this.cache.get<ScrapeResponse>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    // Find career page
    const careerPage = await this.discovery.findCareerPage(domain);

    if (!careerPage) {
      const response: ScrapeResponse = {
        domain,
        hasVacancies: false,
        vacancyCount: 0,
        vacancies: [],
        source: {
          platform: null,
          careerPageUrl: '',
          method: 'ai',
        },
        cached: false,
        scrapedAt: new Date().toISOString(),
      };
      await this.cache.set(cacheKey, response);
      return response;
    }

    let vacancies;
    let method: 'parser' | 'ai' = 'ai';

    // Try platform parser first
    if (careerPage.platform) {
      const platformVacancies = await parseWithPlatform(careerPage.platform, careerPage.url);
      if (platformVacancies) {
        vacancies = platformVacancies;
        method = 'parser';
      }
    }

    // Fall back to AI extraction
    if (!vacancies) {
      const result = await this.aiExtractor.extract(careerPage.html, careerPage.url);
      vacancies = result.vacancies;
      method = 'ai';
    }

    const response: ScrapeResponse = {
      domain,
      hasVacancies: vacancies.length > 0,
      vacancyCount: vacancies.length,
      vacancies,
      source: {
        platform: careerPage.platform,
        careerPageUrl: careerPage.url,
        method,
      },
      cached: false,
      scrapedAt: new Date().toISOString(),
    };

    await this.cache.set(cacheKey, response);
    return response;
  }

  async close(): Promise<void> {
    await Promise.all([
      this.cache.close(),
      this.scraper.close(),
    ]);
  }
}
