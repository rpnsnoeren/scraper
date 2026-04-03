import { Page } from 'playwright';
import { Review } from '../../types/customer-reviews';
import { ReviewParserBase, ParsedReviews } from './base';

/**
 * Gestructureerde data die page.evaluate() teruggeeft vanuit de browser context.
 */
export interface PlaywrightExtractedData {
  averageRating?: number;
  totalReviews?: number;
  reviews: Array<{
    author?: string;
    rating?: number;
    text: string;
    date?: string;
  }>;
}

export class GoogleReviewsParser extends ReviewParserBase {
  async parse(url: string): Promise<ParsedReviews> {
    // Google Maps redirect vaak direct naar de place page bij één resultaat.
    // Gebruik altijd fetchWithPlaywrightCustom zodat we reviews tab kunnen
    // klikken en scrollen, ongeacht of het een zoek- of place-pagina is.
    try {
      const { result, html } = await this.scraper.fetchWithPlaywrightCustom<PlaywrightExtractedData>(
        url,
        (page) => this.extractReviewsWithPlaywright(page),
        45000,
      );

      if (result.reviews.length > 0 || result.averageRating !== undefined) {
        return {
          averageRating: result.averageRating,
          totalReviews: result.totalReviews,
          reviews: this.selectRandom(result.reviews),
        };
      }

      // Fallback: regex extractie op de HTML
      return this.extractFromHtml(html);
    } catch {
      // Bij fout: gewone fetch + regex
      const { html } = await this.scraper.fetchWithPlaywright(url, 20000);
      return this.extractFromHtml(html);
    }
  }

  /**
   * Fallback: extraheert reviews uit ruwe HTML met regex patronen.
   */
  extractFromHtml(html: string): ParsedReviews {
    const averageRating = this.extractAverageRating(html);
    const totalReviews = this.extractTotalReviews(html);
    const reviews = this.extractReviews(html);

    return {
      averageRating,
      totalReviews,
      reviews: this.selectRandom(reviews),
    };
  }

  /**
   * Playwright callback: klikt op de Reviews tab, scrollt het review-paneel,
   * en extraheert individuele reviews via page.evaluate().
   */
  async extractReviewsWithPlaywright(page: Page): Promise<PlaywrightExtractedData> {
    // Wacht tot de pagina geladen is
    await page.waitForTimeout(2000);

    // Extraheer rating en total VÓÓR de tab-klik (staan op Overzicht tab)
    const meta = await page.evaluate(() => {
      let averageRating: number | undefined;
      let totalReviews: number | undefined;

      // Rating: span.fontDisplayLarge of span.MW4etd
      const bigRating = document.querySelector('span.fontDisplayLarge');
      if (bigRating) {
        const val = parseFloat((bigRating.textContent || '').replace(',', '.').trim());
        if (!isNaN(val) && val >= 0 && val <= 5) averageRating = val;
      }
      if (averageRating == null) {
        const smallRating = document.querySelector('span.MW4etd');
        if (smallRating) {
          const val = parseFloat((smallRating.textContent || '').replace(',', '.').trim());
          if (!isNaN(val) && val >= 0 && val <= 5) averageRating = val;
        }
      }

      // Total reviews: zoek "(7)" patroon naast de rating
      const bodyText = document.body.innerText;
      const countMatch = bodyText.match(/\((\d+)\)/);
      if (countMatch) {
        const num = parseInt(countMatch[1], 10);
        if (!isNaN(num) && num > 0 && num < 100000) totalReviews = num;
      }
      // Fallback: "X reviews" of "X beoordelingen"
      if (totalReviews == null) {
        const reviewMatch = bodyText.match(/([\d.,]+)\s*(?:reviews?|beoordelingen)/i);
        if (reviewMatch) {
          const cleaned = reviewMatch[1].replace(/\./g, '').replace(/,/g, '');
          const num = parseInt(cleaned, 10);
          if (!isNaN(num) && num > 0) totalReviews = num;
        }
      }

      return { averageRating, totalReviews };
    });

    // Klik op de Reviews tab als die zichtbaar is
    await this.clickReviewsTab(page);

    // Wacht tot review-elementen verschijnen
    await page.waitForTimeout(2000);

    // Scroll het review-paneel om meer reviews te laden
    await this.scrollReviewPanel(page);

    // Extraheer individuele reviews uit de DOM (na tab-klik en scroll)
    const reviews = await page.evaluate(() => {
      const result: Array<{
        author?: string;
        rating?: number;
        text: string;
        date?: string;
      }> = [];

      // Individuele reviews: zoek top-level elementen met data-review-id en aria-label (auteursnaam)
      // Google Maps heeft geneste data-review-id's — filter op degenen met aria-label (= de review container)
      const allReviewEls = document.querySelectorAll('[data-review-id][aria-label]');
      const seen = new Set<string>();

      for (const block of allReviewEls) {
        const reviewId = block.getAttribute('data-review-id') || '';
        if (seen.has(reviewId)) continue;
        seen.add(reviewId);

        // Auteur: staat in aria-label van het review element zelf
        const author = block.getAttribute('aria-label')?.trim() || undefined;

        // Rating: zoek sterren in geneste elementen
        let rating: number | undefined;
        const starEl = block.querySelector('[aria-label*="sterren"],[aria-label*="stars"],[aria-label*="star"]');
        if (starEl) {
          const starLabel = starEl.getAttribute('aria-label') || '';
          const starMatch = starLabel.match(/(\d+)\s*(?:sterren|stars?)/i);
          if (starMatch) rating = parseInt(starMatch[1], 10);
        }

        // Tekst: specifieke Google class "wiI7pd" voor review tekst
        let text = '';
        const textEl = block.querySelector('span.wiI7pd');
        if (textEl) {
          text = (textEl.textContent || '').trim();
        }
        // Fallback: langste span > 20 chars
        if (!text) {
          const spans = block.querySelectorAll('span');
          for (const span of spans) {
            const t = (span.textContent || '').trim();
            if (t.length > text.length && t.length > 20) text = t;
          }
        }

        if (!text) continue;

        // Datum: relatieve datums
        let date: string | undefined;
        const spans = block.querySelectorAll('span');
        for (const span of spans) {
          const t = (span.textContent || '').trim();
          if (t.match(/\d+\s+(?:dag|dagen|week|weken|maand|maanden|jaar|jaren|day|days|weeks?|months?|years?)\s+(?:geleden|ago)/i)) {
            date = t;
            break;
          }
        }

        result.push({ author, rating, text, date });
      }

      return result;
    });

    return {
      averageRating: meta.averageRating,
      totalReviews: meta.totalReviews,
      reviews,
    };
  }

  /**
   * Klikt op de Reviews/Beoordelingen tab in Google Maps.
   */
  private async clickReviewsTab(page: Page): Promise<void> {
    const tabSelectors = [
      'button[role="tab"]:has-text("Reviews")',
      'button[role="tab"]:has-text("Beoordelingen")',
      'button[role="tab"]:has-text("reviews")',
      'button[role="tab"]:has-text("beoordelingen")',
      '[role="tab"]:has-text("Reviews")',
      '[role="tab"]:has-text("Beoordelingen")',
    ];

    for (const selector of tabSelectors) {
      try {
        const tab = page.locator(selector).first();
        if (await tab.isVisible({ timeout: 1000 })) {
          await tab.click();
          await page.waitForTimeout(1500);
          return;
        }
      } catch {
        // Tab niet gevonden, volgende proberen
      }
    }
  }

  /**
   * Scrollt het review-paneel in Google Maps om meer reviews te laden.
   * Google Maps gebruikt een scrollbaar paneel, niet de hele pagina.
   */
  private async scrollReviewPanel(page: Page): Promise<void> {
    const scrollCount = 6; // 5-8 keer scrollen

    for (let i = 0; i < scrollCount; i++) {
      await page.evaluate(() => {
        // Zoek het scrollbare paneel — Google Maps heeft een scrollbare container
        // Probeer meerdere selectors
        const selectors = [
          '[role="main"]',
          '.section-layout.section-scrollbox',
          'div[tabindex="-1"]',
          '.m6QErb.DxyBCb.kA9KIf.dS8AEf',
        ];

        let scrollContainer: Element | null = null;
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.scrollHeight > el.clientHeight) {
            scrollContainer = el;
            break;
          }
        }

        if (scrollContainer) {
          scrollContainer.scrollTop += 1000;
        } else {
          // Fallback: scroll de hele pagina
          window.scrollBy(0, 1000);
        }
      });
      await page.waitForTimeout(1000);
    }
  }

  /**
   * Extraheert de eerste /maps/place/ URL uit Google Maps zoekresultaten.
   */
  extractPlaceUrl(html: string): string | undefined {
    // Zoek naar href links met /maps/place/
    const hrefMatch = html.match(/href="(https:\/\/www\.google\.[a-z.]+\/maps\/place\/[^"]+)"/);
    if (hrefMatch) {
      return hrefMatch[1];
    }

    // Zoek naar /maps/place/ in data attributen of JavaScript
    const placeMatch = html.match(/(https:\/\/www\.google\.[a-z.]+\/maps\/place\/[^"'\s\\]+)/);
    if (placeMatch) {
      return placeMatch[1];
    }

    // Relatieve URL
    const relativeMatch = html.match(/href="(\/maps\/place\/[^"]+)"/);
    if (relativeMatch) {
      return `https://www.google.com${relativeMatch[1]}`;
    }

    return undefined;
  }

  /**
   * Extraheert de gemiddelde rating uit Google Maps HTML.
   * Zoekt naar aria-label patronen zoals "4,5 sterren" of "4.5 of 5".
   */
  private extractAverageRating(html: string): number | undefined {
    // Patroon 1: aria-label="4,5 sterren" of aria-label="4.5 stars"
    const ariaMatch = html.match(
      /aria-label="([\d.,]+)\s*(?:sterren|stars?)"/i
    );
    if (ariaMatch) {
      return this.parseRating(ariaMatch[1]);
    }

    // Patroon 2: "4.5 of 5" of "4,5 van 5"
    const ofMatch = html.match(/([\d.,]+)\s*(?:of|van)\s*5/i);
    if (ofMatch) {
      return this.parseRating(ofMatch[1]);
    }

    return undefined;
  }

  /**
   * Extraheert het totaal aantal reviews.
   * Zoekt naar "1.234 reviews" of "beoordelingen".
   */
  private extractTotalReviews(html: string): number | undefined {
    const countMatch = html.match(
      /([\d.,]+)\s*(?:reviews?|beoordelingen|ratings?)/i
    );
    if (countMatch) {
      return this.parseReviewCount(countMatch[0]);
    }

    return undefined;
  }

  /**
   * Extraheert individuele reviews uit review blokken.
   */
  private extractReviews(html: string): Review[] {
    const reviews: Review[] = [];

    // Split op review blokken met data-review-id
    const blockPattern = /data-review-id="[^"]*"([\s\S]*?)(?=data-review-id="|$)/g;
    let blockMatch: RegExpExecArray | null;

    while ((blockMatch = blockPattern.exec(html)) !== null) {
      const block = blockMatch[0];
      const review = this.parseReviewBlock(block);
      if (review) {
        reviews.push(review);
      }
    }

    return reviews;
  }

  /**
   * Parset een enkel review blok.
   * Geeft null terug als er geen tekst gevonden is.
   */
  private parseReviewBlock(blockHtml: string): Review | null {
    // Rating: aria-label="5 sterren" of aria-label="4 stars"
    const ratingMatch = blockHtml.match(
      /aria-label="(\d+)\s*(?:sterren|stars?)"/i
    );
    const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : undefined;

    // Tekst: class met review-full-text
    const textMatch = blockHtml.match(
      /class="[^"]*review-full-text[^"]*"[^>]*>([\s\S]*?)<\//
    );
    const text = textMatch ? this.stripHtml(textMatch[1]).trim() : '';

    // Geen tekst = geen bruikbare review
    if (!text) return null;

    // Auteur: aria-label op foto-element, bijv. aria-label="Foto van Jan"
    const authorMatch = blockHtml.match(
      /aria-label="(?:Foto van|Photo of)\s+([^"]+)"/i
    );
    const author = authorMatch ? authorMatch[1].trim() : undefined;

    // Datum: relatieve datums zoals "2 weken geleden", "a month ago"
    const dateMatch = blockHtml.match(
      /(\d+\s+(?:dag|dagen|week|weken|maand|maanden|jaar|jaren|day|days|week|weeks|month|months|year|years)\s+(?:geleden|ago))/i
    );
    const date = dateMatch ? dateMatch[1].trim() : undefined;

    return {
      author: author || undefined,
      rating,
      text,
      date,
    };
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  }
}
