import { ScraperService } from './scraper';

export type ReviewPlatform = 'trustpilot' | 'tripadvisor' | 'google' | 'treatwell' | 'booking' | 'expedia' | 'yelp';

export interface DiscoveredPlatform {
  platform: ReviewPlatform;
  url: string;
}

const PLATFORM_PATTERNS: Record<ReviewPlatform, RegExp> = {
  trustpilot: /https?:\/\/(?:www\.)?trustpilot\.com\/review\/[^\s"'<>]+/gi,
  tripadvisor: /https?:\/\/(?:www\.)?tripadvisor\.(?:com|nl|de|co\.uk)\/(?:Restaurant_Review|Hotel_Review|Attraction_Review|ShowUserReviews)[^\s"'<>]*/gi,
  google: /https?:\/\/(?:www\.)?google\.(?:com|nl|de|co\.uk)\/maps\/place\/[^\s"'<>]+/gi,
  treatwell: /https?:\/\/(?:www\.)?treatwell\.(?:nl|com|de|co\.uk)\/salon\/[^\s"'<>]+/gi,
  booking: /https?:\/\/(?:www\.)?booking\.com\/hotel\/[^\s"'<>]+/gi,
  expedia: /https?:\/\/(?:www\.)?expedia\.(?:com|nl|de|co\.uk)\/[^\s"'<>]+/gi,
  yelp: /https?:\/\/(?:www\.)?yelp\.(?:com|nl|de|co\.uk)\/(?:biz|business)\/[^\s"'<>]+/gi,
};

const DIRECT_URL_TEMPLATES: Partial<Record<ReviewPlatform, (domain: string) => string>> = {
  trustpilot: (domain) => `https://www.trustpilot.com/review/${domain}`,
  google: (domain) => `https://www.google.com/maps/place/${encodeURIComponent(domain)}`,
};

export class ReviewDiscoveryService {
  constructor(private scraper: ScraperService) {}

  buildSearchUrl(businessName: string, domain?: string): string {
    const query = domain
      ? `${businessName} ${domain} reviews`
      : `${businessName} reviews`;
    return `https://www.google.com/search?q=${encodeURIComponent(query)}&num=20`;
  }

  extractPlatformUrls(html: string): DiscoveredPlatform[] {
    const discovered: DiscoveredPlatform[] = [];
    const seenPlatforms = new Set<ReviewPlatform>();

    for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS) as [ReviewPlatform, RegExp][]) {
      // Reset lastIndex voor elke iteratie (global regex)
      pattern.lastIndex = 0;
      const match = pattern.exec(html);

      if (match) {
        const url = this.cleanGoogleUrl(match[0]);
        if (!seenPlatforms.has(platform)) {
          seenPlatforms.add(platform);
          discovered.push({ platform, url });
        }
      }
    }

    return discovered;
  }

  cleanGoogleUrl(url: string): string {
    // Google redirect URLs bevatten de echte URL als query parameter
    if (url.includes('/url?')) {
      try {
        const parsed = new URL(url);
        const actualUrl = parsed.searchParams.get('q') || parsed.searchParams.get('url');
        if (actualUrl) return actualUrl;
      } catch {
        // Geen geldige URL, doorgaan
      }
    }

    // Soms zit de echte URL na &url= of &q= in een niet-standaard formaat
    const redirectMatch = url.match(/[?&](?:q|url)=(https?%3A[^\s&]+)/i);
    if (redirectMatch) {
      try {
        return decodeURIComponent(redirectMatch[1]);
      } catch {
        // Kan niet decoderen, originele URL gebruiken
      }
    }

    return url;
  }

  generateDirectUrls(domain: string): DiscoveredPlatform[] {
    const results: DiscoveredPlatform[] = [];

    for (const [platform, template] of Object.entries(DIRECT_URL_TEMPLATES) as [ReviewPlatform, (d: string) => string][]) {
      results.push({
        platform,
        url: template(domain),
      });
    }

    return results;
  }

  async discover(businessName: string, domain?: string): Promise<DiscoveredPlatform[]> {
    const searchUrl = this.buildSearchUrl(businessName, domain);

    let discovered: DiscoveredPlatform[] = [];

    try {
      const { html } = await this.scraper.fetchWithPlaywright(searchUrl, 30000);
      discovered = this.extractPlatformUrls(html);
    } catch (error) {
      console.error('Google zoekresultaten ophalen mislukt:', error);
    }

    // Voeg directe URL's toe als fallback voor platforms die nog niet gevonden zijn
    if (domain) {
      const directUrls = this.generateDirectUrls(domain);
      const existingPlatforms = new Set(discovered.map(d => d.platform));

      for (const direct of directUrls) {
        if (!existingPlatforms.has(direct.platform)) {
          discovered.push(direct);
        }
      }
    }

    return discovered;
  }
}
