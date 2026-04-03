import { Review } from '../../types/customer-reviews';
import { ReviewParserBase, ParsedReviews } from './base';
import { Page } from 'playwright';

interface PlaywrightReviewData {
  reviews: Array<{
    author?: string;
    rating?: number;
    positive?: string;
    negative?: string;
    date?: string;
  }>;
  averageRating?: number;
  totalReviews?: number;
}

export class BookingParser extends ReviewParserBase {
  async parse(url: string): Promise<ParsedReviews> {
    // Stap 1: Probeer zoekresultaten eerst via HTTP (snel, ~2s) ipv Playwright (~30s)
    let searchHtml: string;
    let detailUrl: string | null = null;

    try {
      const { html: httpHtml } = await this.scraper.fetchWithHttp(url, 10000);
      detailUrl = this.extractDetailUrl(httpHtml);
      searchHtml = httpHtml;
    } catch {
      searchHtml = '';
    }

    // Fallback naar Playwright als HTTP geen hotel-link opleverde
    if (!detailUrl) {
      const { html: pwHtml } = await this.scraper.fetchWithPlaywright(url, 20000);
      detailUrl = this.extractDetailUrl(pwHtml);
      searchHtml = pwHtml;
    }

    // Stap 2: Geen hotel gevonden → stop
    if (!detailUrl) {
      return { reviews: [] };
    }

    // Stap 3: Haal de hotel detailpagina op met scroll-interactie voor reviews
    const reviewUrl = detailUrl.includes('#') ? detailUrl : `${detailUrl}#tab-reviews`;

    const { result, html } = await this.scraper.fetchWithPlaywrightCustom<PlaywrightReviewData>(
      reviewUrl,
      async (page: Page) => this.extractReviewsFromPage(page),
      30000,
    );

    // Gebruik Playwright-geëxtraheerde data als er reviews gevonden zijn
    if (result.reviews.length > 0) {
      const reviews: Review[] = result.reviews
        .map((r) => {
          const parts: string[] = [];
          if (r.positive) parts.push(r.positive);
          if (r.negative) parts.push(`Min: ${r.negative}`);
          const text = parts.join(' | ') || undefined;
          if (!text) return null;

          return {
            author: r.author,
            rating: r.rating != null && r.rating >= 0 && r.rating <= 10
              ? Math.round((r.rating / 2) * 10) / 10
              : undefined,
            text,
            date: r.date,
          } as Review;
        })
        .filter((r): r is Review => r !== null);

      return {
        averageRating: result.averageRating != null && result.averageRating >= 0 && result.averageRating <= 10
          ? Math.round((result.averageRating / 2) * 10) / 10
          : undefined,
        totalReviews: result.totalReviews,
        reviews: this.selectRandom(reviews),
      };
    }

    // Fallback: gebruik HTML regex parsing als Playwright geen reviews vond
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
   * Scrollt naar de reviews-sectie en extraheert review-data via Playwright page.evaluate.
   */
  private async extractReviewsFromPage(page: Page): Promise<PlaywrightReviewData> {
    // Scroll naar de reviews-sectie
    await page.evaluate(() => {
      const reviewSection = document.querySelector('#tab-reviews')
        || document.querySelector('[data-testid*="review"]')
        || document.querySelector('[id*="review"]');
      if (reviewSection) {
        reviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // Wacht tot review cards verschijnen
    await page.waitForSelector('[data-testid="review-card"]', { timeout: 5000 }).catch(() => null);

    // Scroll meerdere keren binnen de reviews-sectie om lazy loading te triggeren
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, 600);
      });
      await page.waitForTimeout(1000);
    }

    // Extraheer review-data direct uit de pagina
    return page.evaluate(() => {
      const data: {
        reviews: Array<{
          author?: string;
          rating?: number;
          positive?: string;
          negative?: string;
          date?: string;
        }>;
        averageRating?: number;
        totalReviews?: number;
      } = { reviews: [] };

      // Gemiddelde rating
      const scoreEl = document.querySelector('[data-testid="review-score"]');
      if (scoreEl) {
        const val = parseFloat((scoreEl.textContent || '').replace(',', '.').trim());
        if (!isNaN(val) && val >= 0 && val <= 10) data.averageRating = val;
      }

      // Totaal aantal reviews
      const reviewCountEl = document.body.innerText.match(/([\d.,]+)\s*(?:gastbeoordelingen|beoordelingen|reviews?)/i);
      if (reviewCountEl) {
        const cleaned = reviewCountEl[1].replace(/\./g, '').replace(/,/g, '');
        const count = parseInt(cleaned, 10);
        if (!isNaN(count)) data.totalReviews = count;
      }

      // Review cards
      const cards = document.querySelectorAll('[data-testid="review-card"]');
      cards.forEach((card) => {
        const scoreEl = card.querySelector('[class*="review-score"]');
        const posEl = card.querySelector('[class*="review-pos"]');
        const negEl = card.querySelector('[class*="review-neg"]');
        const authorEl = card.querySelector('[class*="reviewer-name"]');
        const dateEl = card.querySelector('[class*="review-date"]');

        const positive = posEl?.textContent?.trim() || undefined;
        const negative = negEl?.textContent?.trim() || undefined;

        if (!positive && !negative) return;

        const ratingText = scoreEl?.textContent?.replace(',', '.').trim();
        const rating = ratingText ? parseFloat(ratingText) : undefined;

        data.reviews.push({
          author: authorEl?.textContent?.trim() || undefined,
          rating: rating != null && !isNaN(rating) ? rating : undefined,
          positive,
          negative,
          date: dateEl?.textContent?.trim() || undefined,
        });
      });

      return data;
    });
  }

  /**
   * Extraheert de eerste hotel detail-URL uit zoekresultaten.
   * Zoekt naar links met /hotel/ in het href-attribuut.
   */
  extractDetailUrl(html: string): string | null {
    // Absolute URL (meest voorkomend op Booking.com, bevat vaak &amp; entities)
    const absoluteMatch = html.match(/href="(https?:\/\/www\.booking\.com\/hotel\/[^"]+)"/);
    if (absoluteMatch) {
      return this.decodeHtmlEntities(absoluteMatch[1]);
    }

    // Relatieve URL
    const match = html.match(/href="(\/hotel\/[^"]+)"/);
    if (match) {
      return `https://www.booking.com${this.decodeHtmlEntities(match[1])}`;
    }

    return null;
  }

  /**
   * Extraheert gemiddelde rating. Booking gebruikt 0-10 schaal, converteren naar 0-5.
   */
  private extractAverageRating(html: string): number | undefined {
    // data-testid="review-score"
    const testIdMatch = html.match(/data-testid="review-score"[^>]*>([\s\S]*?)<\//);
    if (testIdMatch) {
      const val = parseFloat(testIdMatch[1].replace(',', '.').trim());
      if (!isNaN(val) && val >= 0 && val <= 10) return Math.round((val / 2) * 10) / 10;
    }

    // "Scored 8.5" of "Scored 8,5"
    const scoredMatch = html.match(/Scored\s+([\d.,]+)/i);
    if (scoredMatch) {
      const val = parseFloat(scoredMatch[1].replace(',', '.'));
      if (val >= 0 && val <= 10) return Math.round((val / 2) * 10) / 10;
    }

    // review-score-badge>8,5 of review-score-badge>8.5
    const badgeMatch = html.match(/review-score-badge[^>]*>([\d.,]+)/);
    if (badgeMatch) {
      const val = parseFloat(badgeMatch[1].replace(',', '.'));
      if (val >= 0 && val <= 10) return Math.round((val / 2) * 10) / 10;
    }

    return undefined;
  }

  private extractTotalReviews(html: string): number | undefined {
    // "567 beoordelingen", "567 gastbeoordelingen", "567 reviews"
    const match = html.match(/([\d.,]+)\s*(?:gastbeoordelingen|beoordelingen|reviews?)/i);
    if (match) {
      // parseReviewCount verwacht "N beoordelingen" formaat — normaliseer gastbeoordelingen
      const normalized = match[0].replace('gastbeoordelingen', 'beoordelingen');
      return this.parseReviewCount(normalized);
    }
    return undefined;
  }

  private extractReviews(html: string): Review[] {
    const reviews: Review[] = [];

    // Zoek review-blokken via data-testid="review-card"
    const cardPattern = /data-testid="review-card"([\s\S]*?)(?=data-testid="review-card"|$)/gi;
    const cards = html.match(cardPattern);

    if (!cards) return reviews;

    for (const card of cards) {
      const review = this.parseReviewCard(card);
      if (review) reviews.push(review);
    }

    return reviews;
  }

  private parseReviewCard(card: string): Review | null {
    const text = this.extractReviewText(card);
    if (!text) return null;

    return {
      author: this.extractAuthor(card),
      rating: this.extractCardRating(card),
      text,
      date: this.extractDate(card),
    };
  }

  /**
   * Combineert positieve en negatieve tekst met " | " separator.
   * Negatieve tekst krijgt prefix "Min: ".
   */
  private extractReviewText(card: string): string | undefined {
    const posMatch = card.match(/class="[^"]*review-pos[^"]*"[^>]*>([\s\S]*?)<\//);
    const negMatch = card.match(/class="[^"]*review-neg[^"]*"[^>]*>([\s\S]*?)<\//);

    const positive = posMatch ? this.stripTags(posMatch[1]).trim() : '';
    const negative = negMatch ? this.stripTags(negMatch[1]).trim() : '';

    if (!positive && !negative) return undefined;

    const parts: string[] = [];
    if (positive) parts.push(positive);
    if (negative) parts.push(`Min: ${negative}`);

    return parts.join(' | ');
  }

  /**
   * Extraheert review-score en converteert van 0-10 naar 0-5.
   */
  private extractCardRating(card: string): number | undefined {
    const match = card.match(/class="[^"]*review-score[^"]*"[^>]*>([\s\S]*?)<\//);
    if (match) {
      const val = parseFloat(match[1].replace(',', '.').trim());
      if (!isNaN(val) && val >= 0 && val <= 10) return Math.round((val / 2) * 10) / 10;
    }
    return undefined;
  }

  private extractAuthor(card: string): string | undefined {
    const match = card.match(/class="[^"]*reviewer-name[^"]*"[^>]*>([\s\S]*?)<\//);
    if (match) {
      const name = this.stripTags(match[1]).trim();
      return name || undefined;
    }
    return undefined;
  }

  private extractDate(card: string): string | undefined {
    const match = card.match(/class="[^"]*review-date[^"]*"[^>]*>([\s\S]*?)<\//);
    if (match) {
      const date = this.stripTags(match[1]).trim();
      return date || undefined;
    }
    return undefined;
  }

  private stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  }
}
