import { chromium, Browser, Page } from 'playwright';

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

  async fetchWithPlaywright(url: string, timeout = 45000): Promise<{ html: string; status: number }> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      });
    }

    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'nl-NL',
      timezoneId: 'Europe/Amsterdam',
    });

    const page = await context.newPage();

    // Remove webdriver property to avoid detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // @ts-ignore
      window.chrome = { runtime: {} };
    });

    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout });
      const status = response?.status() ?? 0;

      // Wait for content to load
      await page.waitForTimeout(3000);

      // Dismiss cookie consent banners
      await this.dismissCookieConsent(page);

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

      const html = await page.content();
      return { html, status };
    } finally {
      await context.close();
    }
  }

  /**
   * Fetch met Playwright en voer custom interactie uit op de pagina.
   * De callback ontvangt het Page object en kan scrollen, klikken, data extracten etc.
   */
  async fetchWithPlaywrightCustom<T>(
    url: string,
    callback: (page: Page) => Promise<T>,
    timeout = 45000,
  ): Promise<{ result: T; html: string; status: number }> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      });
    }

    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'nl-NL',
      timezoneId: 'Europe/Amsterdam',
    });

    const page = await context.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // @ts-ignore
      window.chrome = { runtime: {} };
    });

    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout });
      const status = response?.status() ?? 0;

      await page.waitForTimeout(2000);
      await this.dismissCookieConsent(page);

      const result = await callback(page);
      const html = await page.content();

      return { result, html, status };
    } finally {
      await context.close();
    }
  }

  async fetch(url: string): Promise<{ html: string; usedPlaywright: boolean; status: number }> {
    try {
      const { html, status } = await this.fetchWithHttp(url);

      if (status === 200 && !this.needsJavaScript(html)) {
        return { html, usedPlaywright: false, status };
      }
    } catch {
      // HTTP failed, try Playwright
    }

    const { html, status } = await this.fetchWithPlaywright(url);
    return { html, usedPlaywright: true, status };
  }

  private async dismissCookieConsent(page: Page): Promise<void> {
    const selectors = [
      // Veelvoorkomende cookie consent knoppen (Nederlands + Engels)
      'button:has-text("Accepteren")',
      'button:has-text("Alles accepteren")',
      'button:has-text("Alle cookies accepteren")',
      'button:has-text("Accept")',
      'button:has-text("Accept all")',
      'button:has-text("Accept All Cookies")',
      'button:has-text("Akkoord")',
      'button:has-text("Toestaan")',
      'button:has-text("Ik ga akkoord")',
      'button:has-text("Begrepen")',
      'button:has-text("OK")',
      'button:has-text("Agree")',
      // Veelvoorkomende cookie consent frameworks
      '#onetrust-accept-btn-handler',
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      '.cc-accept',
      '.cc-btn.cc-allow',
      '[data-cookiefirst-action="accept"]',
      '.cookie-consent-accept',
      '.js-cookie-accept',
      '#cookie-accept',
      '.cmplz-accept',
      // CookieYes
      '.cky-btn-accept',
      '[data-cky-tag="accept-button"]',
    ];

    for (const selector of selectors) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 500 })) {
          await button.click();
          await page.waitForTimeout(1000);
          return;
        }
      } catch {
        // Selector niet gevonden, volgende proberen
      }
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
