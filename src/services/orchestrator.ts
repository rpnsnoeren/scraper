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

  async scrape(domain: string, detailLimit: number = 0): Promise<ScrapeResponse> {
    const cacheKey = this.cache.keyFor(domain + (detailLimit > 0 ? `:details:${detailLimit}` : ''));

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
      // First extract from main career page
      const result = await this.aiExtractor.extract(
        careerPage.html,
        careerPage.url,
        careerPage.additionalUrls
      );
      vacancies = result.vacancies;
      method = 'ai';

      // If we found few vacancies, try scraping department pages
      if (vacancies.length < 5) {
        const departmentLinks = this.discovery.extractDepartmentLinks(careerPage.html, careerPage.url);
        console.log(`Found ${departmentLinks.length} department links to check`);

        // Scrape up to 5 department pages
        for (const deptUrl of departmentLinks.slice(0, 5)) {
          try {
            const { html: deptHtml } = await this.scraper.fetch(deptUrl);
            const deptResult = await this.aiExtractor.extract(deptHtml, deptUrl);

            // Add new vacancies (dedupe by ID)
            const existingIds = new Set(vacancies.map(v => v.id));
            for (const v of deptResult.vacancies) {
              if (!existingIds.has(v.id)) {
                vacancies.push(v);
                existingIds.add(v.id);
              }
            }
          } catch (err) {
            console.error(`Failed to scrape department page ${deptUrl}:`, err);
          }
        }
      }
    }

    // Scrape individual vacancy pages for more details if requested
    if (detailLimit > 0 && vacancies.length > 0) {
      console.log(`Scraping details for up to ${detailLimit} vacancies...`);
      const vacanciesToDetail = vacancies.slice(0, detailLimit);

      for (let i = 0; i < vacanciesToDetail.length; i++) {
        const vacancy = vacanciesToDetail[i];
        // Skip if URL is the same as career page (no dedicated vacancy page)
        if (vacancy.url === careerPage.url) {
          console.log(`Skipping ${vacancy.title} - no dedicated page`);
          continue;
        }

        try {
          console.log(`[${i + 1}/${vacanciesToDetail.length}] Fetching details for: ${vacancy.title}`);
          const { html: detailHtml } = await this.scraper.fetch(vacancy.url);
          const details = await this.aiExtractor.extractDetails(detailHtml, vacancy);

          // Merge details into vacancy
          Object.assign(vacancy, details);
          console.log(`  ✓ Got details: ${details.requirements?.length || 0} requirements, ${details.benefits?.length || 0} benefits`);
        } catch (err) {
          console.error(`  ✗ Failed to get details for ${vacancy.title}:`, err);
        }
      }
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
