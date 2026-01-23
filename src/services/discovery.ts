import { ScraperService } from './scraper';
import { getCareerPageCandidates, normalizeUrl } from '../utils/url';

export type Platform = 'recruitee' | 'greenhouse' | 'lever' | 'workable' | null;

export class DiscoveryService {
  constructor(private scraper: ScraperService) {}

  detectPlatform(url: string): Platform {
    const lower = url.toLowerCase();

    if (lower.includes('recruitee.com')) return 'recruitee';
    if (lower.includes('greenhouse.io')) return 'greenhouse';
    if (lower.includes('lever.co')) return 'lever';
    if (lower.includes('workable.com')) return 'workable';

    return null;
  }

  detectPlatformFromHtml(html: string): Platform {
    const lower = html.toLowerCase();

    if (lower.includes('recruitee') || lower.includes('d3ii2lldyojfer.cloudfront.net')) {
      return 'recruitee';
    }
    if (lower.includes('greenhouse-jobboard') || lower.includes('boards.greenhouse.io')) {
      return 'greenhouse';
    }
    if (lower.includes('lever-jobs') || lower.includes('jobs.lever.co')) {
      return 'lever';
    }
    if (lower.includes('workable-careers')) {
      return 'workable';
    }

    return null;
  }

  async findCareerPage(domain: string): Promise<{
    url: string;
    html: string;
    platform: Platform;
  } | null> {
    const candidates = getCareerPageCandidates(domain);

    for (let i = 0; i < candidates.length; i += 3) {
      const batch = candidates.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map(async (url) => {
          const { html } = await this.scraper.fetch(url);
          return { url, html };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { url, html } = result.value;
          if (this.looksLikeCareerPage(html)) {
            const platform = this.detectPlatform(url) || this.detectPlatformFromHtml(html);
            return { url, html, platform };
          }
        }
      }
    }

    try {
      const { html } = await this.scraper.fetch(normalizeUrl(domain));
      const careerLinks = this.scraper.extractCareerLinks(html, normalizeUrl(domain));

      for (const link of careerLinks.slice(0, 3)) {
        try {
          const { html: careerHtml } = await this.scraper.fetch(link);
          if (this.looksLikeCareerPage(careerHtml)) {
            const platform = this.detectPlatform(link) || this.detectPlatformFromHtml(careerHtml);
            return { url: link, html: careerHtml, platform };
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Homepage not accessible
    }

    return null;
  }

  private looksLikeCareerPage(html: string): boolean {
    const lower = html.toLowerCase();
    const careerIndicators = [
      'vacancy', 'vacancies', 'vacature', 'vacatures',
      'job opening', 'job listings', 'open position',
      'we are hiring', 'join our team', 'career',
      'werken bij', 'kom werken',
    ];

    return careerIndicators.some(indicator => lower.includes(indicator));
  }
}
