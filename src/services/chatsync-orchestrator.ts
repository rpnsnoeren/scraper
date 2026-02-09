import { CacheService } from './cache';
import { ScraperService } from './scraper';
import { DiscoveryService } from './discovery';
import { ContentExtractor } from './content-extractor';
import { ChatSyncPage, ChatSyncResponse } from '../types/chatsync';
import { normalizeUrl } from '../utils/url';

const PRIORITY_PATTERNS = [
  /^\/?$/,
  /\/(about|over|over-ons|wie-zijn-wij)/i,
  /\/(services?|diensten)/i,
  /\/(products?|producten)/i,
  /\/(pricing|prijzen|tarieven)/i,
  /\/(faq|veelgestelde-vragen)/i,
  /\/(contact)/i,
  /\/(team|medewerkers)/i,
  /\/(features?|functies|mogelijkheden)/i,
  /\/(solutions?|oplossingen)/i,
  /\/(how-it-works|hoe-werkt-het)/i,
  /\/(blog|nieuws|news)\/?\??/i,
];

const SKIP_PATTERNS = [
  /\/(privacy|privacybeleid|privacy-policy|privacy-statement)/i,
  /\/(cookie|cookies|cookiebeleid)/i,
  /\/(terms|voorwaarden|algemene-voorwaarden|terms-of-service)/i,
  /\/(login|inloggen|signin|sign-in)/i,
  /\/(register|registreren|signup|sign-up)/i,
  /\/(admin|dashboard|beheer)/i,
  /\/(search|zoeken)/i,
  /\/(cart|winkelwagen|checkout|afrekenen)/i,
  /\/(account|profiel|profile)/i,
  /\/(sitemap\.xml|robots\.txt)/i,
  /\.(pdf|jpg|jpeg|png|gif|svg|css|js|zip|doc|docx)$/i,
  /[?&](page|p)=\d/i,
  /#/,
];

export class ChatSyncOrchestrator {
  private cache: CacheService;
  private scraper: ScraperService;
  private discovery: DiscoveryService;
  private extractor: ContentExtractor;

  constructor(cache: CacheService, scraper: ScraperService, discovery: DiscoveryService) {
    this.cache = cache;
    this.scraper = scraper;
    this.discovery = discovery;
    this.extractor = new ContentExtractor();
  }

  async scrape(domain: string, maxPages: number = 20): Promise<ChatSyncResponse> {
    const cacheKey = `chatsync:${domain.toLowerCase()}:${maxPages}`;

    // Check cache
    const cached = await this.cache.get<ChatSyncResponse>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const baseUrl = normalizeUrl(domain);

    // Fetch all sitemap URLs
    console.log(`[ChatSync] Fetching sitemap for ${domain}...`);
    const sitemapUrls = await this.discovery.fetchAllSitemapUrls(domain);
    console.log(`[ChatSync] Found ${sitemapUrls.length} URLs in sitemap`);

    // If no sitemap, fall back to discovering links from homepage
    let urls: string[] = [];
    if (sitemapUrls.length > 0) {
      urls = sitemapUrls;
    } else {
      console.log(`[ChatSync] No sitemap found, crawling homepage for links...`);
      urls = await this.discoverLinksFromHomepage(baseUrl, domain);
    }

    // Filter and prioritize URLs
    const filteredUrls = this.filterAndPrioritize(urls, baseUrl);
    const targetUrls = filteredUrls.slice(0, maxPages);

    console.log(`[ChatSync] Scraping ${targetUrls.length} pages (filtered from ${urls.length})...`);

    // Scrape each page with rate limiting
    const pages: ChatSyncPage[] = [];
    const seenHashes = new Set<string>();

    for (let i = 0; i < targetUrls.length; i++) {
      const url = targetUrls[i];
      try {
        console.log(`[ChatSync] [${i + 1}/${targetUrls.length}] ${url}`);
        const { html, status } = await this.scraper.fetchWithHttp(url);

        if (status >= 400) {
          console.log(`[ChatSync]   Skipped (HTTP ${status})`);
          continue;
        }

        const page = this.extractPage(html, url);

        // Skip empty/very short pages
        if (page.content.length < 50) {
          console.log(`[ChatSync]   Skipped (too short)`);
          continue;
        }

        // Deduplicate on content hash
        if (seenHashes.has(page.content_hash)) {
          console.log(`[ChatSync]   Skipped (duplicate content)`);
          continue;
        }

        seenHashes.add(page.content_hash);
        pages.push(page);

        // Rate limit: 1 request per second
        if (i < targetUrls.length - 1) {
          await this.delay(1000);
        }
      } catch (err) {
        console.error(`[ChatSync]   Failed: ${err}`);
      }
    }

    const response: ChatSyncResponse = {
      domain,
      pageCount: pages.length,
      pages,
      cached: false,
      scrapedAt: new Date().toISOString(),
    };

    await this.cache.set(cacheKey, response);
    return response;
  }

  private extractPage(html: string, url: string): ChatSyncPage {
    const mainContent = this.extractor.extractMainContent(html);
    const headings = this.extractor.extractHeadings(mainContent);
    const markdown = this.extractor.htmlToMarkdown(mainContent);
    const content = this.extractor.truncateContent(markdown);
    const title = this.extractor.extractTitle(html);

    return {
      url,
      title,
      content,
      meta_description: this.extractor.extractMetaDescription(html),
      headings,
      page_type: this.extractor.classifyPage(url, title, content),
      content_hash: this.extractor.createContentHash(content),
      scraped_at: new Date().toISOString(),
    };
  }

  private async discoverLinksFromHomepage(baseUrl: string, domain: string): Promise<string[]> {
    try {
      const { html, status } = await this.scraper.fetchWithHttp(baseUrl);
      if (status >= 400) return [baseUrl];

      const links: string[] = [baseUrl];
      const linkRegex = /<a[^>]+href=["']([^"'#]+)["']/gi;
      let match;

      while ((match = linkRegex.exec(html)) !== null) {
        try {
          const fullUrl = new URL(match[1], baseUrl).href;
          // Only include internal links
          if (fullUrl.includes(domain.replace('www.', ''))) {
            links.push(fullUrl);
          }
        } catch {
          // Invalid URL
        }
      }

      return [...new Set(links)];
    } catch {
      return [baseUrl];
    }
  }

  private filterAndPrioritize(urls: string[], baseUrl: string): string[] {
    // Filter out unwanted URLs
    const filtered = urls.filter(url => {
      try {
        const path = new URL(url).pathname;
        return !SKIP_PATTERNS.some(pattern => pattern.test(path));
      } catch {
        return false;
      }
    });

    // Sort: priority pages first, then by URL length (shorter = more important)
    return filtered.sort((a, b) => {
      const aPath = new URL(a).pathname;
      const bPath = new URL(b).pathname;

      const aPriority = PRIORITY_PATTERNS.findIndex(p => p.test(aPath));
      const bPriority = PRIORITY_PATTERNS.findIndex(p => p.test(bPath));

      const aScore = aPriority >= 0 ? aPriority : 999;
      const bScore = bPriority >= 0 ? bPriority : 999;

      if (aScore !== bScore) return aScore - bScore;
      return a.length - b.length;
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
