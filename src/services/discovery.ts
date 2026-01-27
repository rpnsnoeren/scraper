import { ScraperService } from './scraper';
import { getCareerPageCandidates, normalizeUrl } from '../utils/url';

export type Platform = 'recruitee' | 'greenhouse' | 'lever' | 'workable' | null;

const CAREER_KEYWORDS = [
  'career', 'careers', 'job', 'jobs', 'vacatur', 'vacancies', 'vacancy',
  'werken', 'werk', 'hiring', 'openings', 'positions', 'join',
  'recruitment', 'talent', 'opportunities', 'sollicit',
];

export class DiscoveryService {
  constructor(private scraper: ScraperService) {}

  async fetchSitemapUrls(domain: string): Promise<string[]> {
    const baseUrl = normalizeUrl(domain);
    const sitemapUrls = [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap_index.xml`,
      `${baseUrl}/sitemap-index.xml`,
      `${baseUrl}/sitemaps.xml`,
    ];

    const allUrls: string[] = [];

    for (const sitemapUrl of sitemapUrls) {
      try {
        const response = await fetch(sitemapUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VacancyBot/1.0)' },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) continue;

        const xml = await response.text();
        const urls = this.parseSitemapXml(xml);

        // Check if this is a sitemap index (contains other sitemaps)
        const nestedSitemaps = urls.filter(u => u.endsWith('.xml'));
        if (nestedSitemaps.length > 0) {
          // Fetch nested sitemaps that might contain career pages
          const careerSitemaps = nestedSitemaps.filter(u =>
            CAREER_KEYWORDS.some(kw => u.toLowerCase().includes(kw))
          );

          for (const nestedUrl of careerSitemaps.slice(0, 3)) {
            try {
              const nestedResponse = await fetch(nestedUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VacancyBot/1.0)' },
                signal: AbortSignal.timeout(10000),
              });
              if (nestedResponse.ok) {
                const nestedXml = await nestedResponse.text();
                allUrls.push(...this.parseSitemapXml(nestedXml));
              }
            } catch {
              continue;
            }
          }
        }

        allUrls.push(...urls);

        if (allUrls.length > 0) break; // Found a working sitemap
      } catch {
        continue;
      }
    }

    // Filter for career-related URLs
    return allUrls.filter(url => {
      const lower = url.toLowerCase();
      return CAREER_KEYWORDS.some(kw => lower.includes(kw));
    });
  }

  private parseSitemapXml(xml: string): string[] {
    const urls: string[] = [];
    // Match <loc>...</loc> tags
    const locRegex = /<loc>([^<]+)<\/loc>/gi;
    let match;
    while ((match = locRegex.exec(xml)) !== null) {
      urls.push(match[1].trim());
    }
    return urls;
  }

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
    additionalUrls?: string[];
  } | null> {
    // First, try to find career URLs from sitemap
    const sitemapUrls = await this.fetchSitemapUrls(domain);
    console.log(`Found ${sitemapUrls.length} career-related URLs in sitemap`);

    // Try sitemap URLs first (they're often more direct)
    if (sitemapUrls.length > 0) {
      // Sort by likelihood of being a main careers page
      const sortedUrls = this.sortCareerUrls(sitemapUrls);

      for (const url of sortedUrls.slice(0, 5)) {
        try {
          const { html, status } = await this.scraper.fetch(url);
          if (status >= 400) continue; // Skip error pages (404, 500, etc.)
          if (this.looksLikeCareerPage(html)) {
            const platform = this.detectPlatform(url) || this.detectPlatformFromHtml(html);
            // Pass along other sitemap URLs for the AI to consider
            return { url, html, platform, additionalUrls: sortedUrls.slice(0, 50) };
          }
        } catch {
          continue;
        }
      }
    }

    // Fall back to standard URL candidates
    const candidates = getCareerPageCandidates(domain);

    for (let i = 0; i < candidates.length; i += 3) {
      const batch = candidates.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map(async (url) => {
          const { html, status } = await this.scraper.fetch(url);
          return { url, html, status };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { url, html, status } = result.value;
          if (status >= 400) continue; // Skip error pages (404, 500, etc.)
          if (this.looksLikeCareerPage(html)) {
            const platform = this.detectPlatform(url) || this.detectPlatformFromHtml(html);
            return { url, html, platform, additionalUrls: sitemapUrls.slice(0, 50) };
          }
        }
      }
    }

    try {
      const { html, status: homeStatus } = await this.scraper.fetch(normalizeUrl(domain));
      if (homeStatus < 400) {
        const careerLinks = this.scraper.extractCareerLinks(html, normalizeUrl(domain));

        for (const link of careerLinks.slice(0, 3)) {
          try {
            const { html: careerHtml, status: linkStatus } = await this.scraper.fetch(link);
            if (linkStatus >= 400) continue; // Skip error pages
            if (this.looksLikeCareerPage(careerHtml)) {
              const platform = this.detectPlatform(link) || this.detectPlatformFromHtml(careerHtml);
              return { url: link, html: careerHtml, platform, additionalUrls: sitemapUrls.slice(0, 50) };
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      // Homepage not accessible
    }

    return null;
  }

  private sortCareerUrls(urls: string[]): string[] {
    // Prioritize main career pages over individual job posts
    const mainPagePatterns = [
      /\/(careers?|jobs?|vacatures?|werken-bij|werkenbij)\/?$/i,
      /\/(careers?|jobs?|vacatures?)\/(overview|all|list)?\/?$/i,
    ];

    return urls.sort((a, b) => {
      const aIsMain = mainPagePatterns.some(p => p.test(a));
      const bIsMain = mainPagePatterns.some(p => p.test(b));
      if (aIsMain && !bIsMain) return -1;
      if (bIsMain && !aIsMain) return 1;
      return a.length - b.length; // Shorter URLs tend to be overview pages
    });
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

  // Extract department/category links from career page to scrape more vacancies
  extractDepartmentLinks(html: string, baseUrl: string): string[] {
    const links: string[] = [];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;

    const departmentKeywords = [
      'tech', 'engineering', 'development', 'software',
      'marketing', 'sales', 'finance', 'hr', 'legal',
      'operations', 'logistics', 'support', 'service',
      'design', 'product', 'data', 'analytics',
      'hoofdkantoor', 'magazijn', 'bezorging', 'winkels',
      'klantenservice', 'stage', 'bijbanen',
    ];

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const lower = href.toLowerCase();

      if (departmentKeywords.some(kw => lower.includes(kw))) {
        try {
          const fullUrl = new URL(href, baseUrl).href;
          // Only include internal links
          if (fullUrl.includes(new URL(baseUrl).hostname.replace('www.', ''))) {
            links.push(fullUrl);
          }
        } catch {
          // Invalid URL
        }
      }
    }

    return [...new Set(links)];
  }
}
