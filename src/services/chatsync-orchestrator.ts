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

    // Eerst een snelle HTTP check op de homepage om te bepalen of deze site
    // Playwright nodig heeft (sommige sites geven 404 op subpagina's via HTTP)
    let siteNeedsPlaywright = false;
    try {
      const testUrl = targetUrls.find(u => u !== baseUrl) || targetUrls[0];
      const testResult = await this.scraper.fetchWithHttp(testUrl);
      if (testResult.status >= 400 || this.scraper.needsJavaScript(testResult.html)) {
        siteNeedsPlaywright = true;
        console.log(`[ChatSync] Site vereist Playwright (HTTP gaf status ${testResult.status})`);
      }
    } catch {
      siteNeedsPlaywright = true;
      console.log(`[ChatSync] Site vereist Playwright (HTTP fetch mislukt)`);
    }

    // Scrape pagina's — parallel in batches van 3 als Playwright nodig is
    const BATCH_SIZE = siteNeedsPlaywright ? 3 : 5;
    const pages: ChatSyncPage[] = [];
    const seenHashes = new Set<string>();
    const startTime = Date.now();

    for (let i = 0; i < targetUrls.length; i += BATCH_SIZE) {
      const batch = targetUrls.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(targetUrls.length / BATCH_SIZE);
      console.log(`[ChatSync] Batch ${batchNum}/${totalBatches} (${batch.length} pagina's, ${Math.round((Date.now() - startTime) / 1000)}s verstreken)`);

      const results = await Promise.allSettled(
        batch.map(url => this.fetchPage(url, siteNeedsPlaywright))
      );

      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        const { html, url } = result.value;

        const page = this.extractPage(html, url);

        if (page.content.length < 50) {
          console.log(`[ChatSync]   Skipped (too short): ${url}`);
          continue;
        }

        if (seenHashes.has(page.content_hash)) {
          console.log(`[ChatSync]   Skipped (duplicate): ${url}`);
          continue;
        }

        seenHashes.add(page.content_hash);
        pages.push(page);
      }

      // Rate limit tussen batches
      if (i + BATCH_SIZE < targetUrls.length) {
        await this.delay(500);
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[ChatSync] Klaar: ${pages.length} pagina's in ${elapsed}s`);

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

  private async fetchPage(
    url: string,
    usePlaywright: boolean,
  ): Promise<{ html: string; url: string } | null> {
    try {
      if (!usePlaywright) {
        const result = await this.scraper.fetchWithHttp(url);
        if (result.status < 400 && !this.scraper.needsJavaScript(result.html)) {
          return { html: result.html, url };
        }
      }
      // Playwright met kortere timeout (20s i.p.v. default 45s)
      const result = await this.scraper.fetchWithPlaywright(url, 20000);
      if (result.status >= 400) {
        console.log(`[ChatSync]   HTTP ${result.status}: ${url}`);
        return null;
      }
      return { html: result.html, url };
    } catch (err) {
      console.error(`[ChatSync]   Failed: ${url} — ${err}`);
      return null;
    }
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
      let html: string;
      let usePlaywright = false;

      try {
        const result = await this.scraper.fetchWithHttp(baseUrl);
        if (result.status >= 400 || this.scraper.needsJavaScript(result.html)) {
          usePlaywright = true;
        }
        html = result.html;
      } catch {
        usePlaywright = true;
        html = '';
      }

      if (usePlaywright) {
        console.log(`[ChatSync] Homepage fallback naar Playwright...`);
        const result = await this.scraper.fetchWithPlaywright(baseUrl);
        if (result.status >= 400) return [baseUrl];
        html = result.html;
      }

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
        // Skip mailto:, tel:, javascript: links
        if (/^(mailto:|tel:|javascript:|#)/i.test(url)) return false;
        const parsed = new URL(url);
        // Skip non-http protocols
        if (!parsed.protocol.startsWith('http')) return false;
        // Skip file downloads
        if (/\.(pdf|zip|doc|xls|png|jpg|gif|svg)$/i.test(parsed.pathname)) return false;
        const path = parsed.pathname;
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
