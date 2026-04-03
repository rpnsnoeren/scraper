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
    const { html: searchHtml } = await this.scraper.fetchWithPlaywright(url, 20000);

    // Stap 1: Zoek de detail-pagina URL uit de zoekresultaten
    const placeUrl = this.extractPlaceUrl(searchHtml);

    // Stap 2: Als een place URL gevonden is, gebruik Playwright custom interactie
    // om reviews te laden via scrollen
    if (placeUrl) {
      try {
        const { result, html: detailHtml } = await this.scraper.fetchWithPlaywrightCustom<PlaywrightExtractedData>(
          placeUrl,
          (page) => this.extractReviewsWithPlaywright(page),
          60000,
        );

        // Als Playwright data heeft opgeleverd, gebruik die
        if (result.reviews.length > 0 || result.averageRating !== undefined) {
          return {
            averageRating: result.averageRating,
            totalReviews: result.totalReviews,
            reviews: this.selectRandom(result.reviews),
          };
        }

        // Fallback: probeer regex extractie op de HTML
        return this.extractFromHtml(detailHtml);
      } catch {
        // Bij fout in Playwright custom: fallback naar gewone fetch
        const { html: detailHtml } = await this.scraper.fetchWithPlaywright(placeUrl, 20000);
        return this.extractFromHtml(detailHtml);
      }
    }

    // Geen place URL gevonden — Google heeft mogelijk direct doorgestuurd
    // naar een place pagina (bij exact één resultaat). Gebruik de huidige HTML.
    return this.extractFromHtml(searchHtml);
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

    // Klik op de Reviews tab als die zichtbaar is
    await this.clickReviewsTab(page);

    // Wacht tot review-elementen verschijnen
    await page.waitForTimeout(2000);

    // Scroll het review-paneel 5-8 keer om meer reviews te laden
    await this.scrollReviewPanel(page);

    // Extraheer alle data uit de DOM
    const data = await page.evaluate(() => {
      const result: {
        averageRating?: number;
        totalReviews?: number;
        reviews: Array<{
          author?: string;
          rating?: number;
          text: string;
          date?: string;
        }>;
      } = { reviews: [] };

      // Gemiddelde rating: zoek aria-label met sterren/stars
      const ratingEl = document.querySelector('[aria-label*="sterren"],[aria-label*="stars"]');
      if (ratingEl) {
        const label = ratingEl.getAttribute('aria-label') || '';
        const match = label.match(/([\d.,]+)\s*(?:sterren|stars?)/i);
        if (match) {
          result.averageRating = parseFloat(match[1].replace(',', '.'));
        }
      }

      // Totaal reviews: zoek tekst met "reviews" of "beoordelingen"
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        if (el.children.length > 0) continue; // Alleen bladnodes
        const text = (el.textContent || '').trim();
        const countMatch = text.match(/([\d.,]+)\s*(?:reviews?|beoordelingen|ratings?)/i);
        if (countMatch) {
          const cleaned = countMatch[1].replace(/\./g, '').replace(/,/g, '');
          const num = parseInt(cleaned, 10);
          if (!isNaN(num) && num > 0) {
            result.totalReviews = num;
            break;
          }
        }
      }

      // Individuele reviews: zoek elementen met data-review-id
      const reviewBlocks = document.querySelectorAll('[data-review-id]');
      for (const block of reviewBlocks) {
        // Rating uit aria-label
        let rating: number | undefined;
        const starEl = block.querySelector('[aria-label*="sterren"],[aria-label*="stars"],[aria-label*="star"]');
        if (starEl) {
          const starLabel = starEl.getAttribute('aria-label') || '';
          const starMatch = starLabel.match(/(\d+)\s*(?:sterren|stars?)/i);
          if (starMatch) {
            rating = parseInt(starMatch[1], 10);
          }
        }

        // Tekst: zoek de langste tekst-span in het blok
        let text = '';
        const spans = block.querySelectorAll('span');
        for (const span of spans) {
          const spanText = (span.textContent || '').trim();
          // Filter korte teksten en datums
          if (spanText.length > text.length && spanText.length > 10) {
            text = spanText;
          }
        }

        // Als geen tekst gevonden, sla over
        if (!text) continue;

        // Auteur: zoek aria-label met "Foto van" of "Photo of"
        let author: string | undefined;
        const authorEl = block.querySelector('[aria-label*="Foto van"],[aria-label*="Photo of"]');
        if (authorEl) {
          const authorLabel = authorEl.getAttribute('aria-label') || '';
          const authorMatch = authorLabel.match(/(?:Foto van|Photo of)\s+(.+)/i);
          if (authorMatch) {
            author = authorMatch[1].trim();
          }
        }
        // Fallback: zoek auteursnaam via button of link met aria-label
        if (!author) {
          const nameEl = block.querySelector('button[aria-label],a[aria-label]');
          if (nameEl) {
            const nameLabel = nameEl.getAttribute('aria-label') || '';
            if (nameLabel && nameLabel.length < 50 && !nameLabel.match(/sterren|stars?|foto|photo/i)) {
              author = nameLabel.trim();
            }
          }
        }

        // Datum: relatieve datums
        let date: string | undefined;
        for (const span of spans) {
          const spanText = (span.textContent || '').trim();
          if (spanText.match(/\d+\s+(?:dag|dagen|week|weken|maand|maanden|jaar|jaren|day|days|weeks?|months?|years?)\s+(?:geleden|ago)/i)) {
            date = spanText;
            break;
          }
        }

        result.reviews.push({ author, rating, text, date });
      }

      return result;
    });

    return data;
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
