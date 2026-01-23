import { chromium, Browser } from 'playwright';

export class ScraperService {
  private browser: Browser | null = null;

  needsJavaScript(html: string): boolean {
    // Very short pages likely need JS
    if (html.length < 1000) return true;

    const spaIndicators = [
      /<div id="(root|app|__next)">\s*<\/div>/i,
      /loading\.\.\./i,
      /<noscript>.*enable javascript/i,
      /glimlach/i, // Coolblue loading page
      /<body[^>]*>\s*<\/body>/i, // Empty body
    ];

    // Check if there's actual meaningful content
    const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const hasContent = textContent.length > 500;
    const hasSpaIndicator = spaIndicators.some(pattern => pattern.test(html));

    return hasSpaIndicator || !hasContent;
  }

  extractCareerLinks(html: string, baseUrl: string): string[] {
    const careerKeywords = ['career', 'jobs', 'vacatur', 'werken', 'join', 'hiring', 'openings'];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)/gi;
    const links: string[] = [];

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const [, href, text] = match;
      const lowerHref = href.toLowerCase();
      const lowerText = text.toLowerCase();

      if (careerKeywords.some(kw => lowerHref.includes(kw) || lowerText.includes(kw))) {
        try {
          const fullUrl = new URL(href, baseUrl).href;
          links.push(fullUrl);
        } catch {
          // Invalid URL, skip
        }
      }
    }

    return [...new Set(links)];
  }

  async fetchWithHttp(url: string, timeout = 10000): Promise<{ html: string; status: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VacancyBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });

      const html = await response.text();
      return { html, status: response.status };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async fetchWithPlaywright(url: string, timeout = 45000): Promise<string> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }

    const page = await this.browser.newPage();

    // Set a realistic viewport and user agent
    await page.setViewportSize({ width: 1920, height: 1080 });

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout });

      // Wait for content to load
      await page.waitForTimeout(3000);

      // Scroll to load lazy content
      await page.evaluate(async () => {
        for (let i = 0; i < 3; i++) {
          window.scrollBy(0, window.innerHeight);
          await new Promise(r => setTimeout(r, 500));
        }
        window.scrollTo(0, 0);
      });

      // Wait a bit more after scrolling
      await page.waitForTimeout(2000);

      return await page.content();
    } finally {
      await page.close();
    }
  }

  async fetch(url: string): Promise<{ html: string; usedPlaywright: boolean }> {
    try {
      const { html, status } = await this.fetchWithHttp(url);

      if (status === 200 && !this.needsJavaScript(html)) {
        return { html, usedPlaywright: false };
      }
    } catch {
      // HTTP failed, try Playwright
    }

    const html = await this.fetchWithPlaywright(url);
    return { html, usedPlaywright: true };
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
