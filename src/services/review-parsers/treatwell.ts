import { Review } from '../../types/customer-reviews';
import { ReviewParserBase, ParsedReviews } from './base';

interface TreatwellNextDataReview {
  text?: string;
  comment?: string;
  body?: string;
  title?: string;
  rating?: number;
  score?: number;
  author?: string | { name?: string; displayName?: string; firstName?: string };
  name?: string;
  user?: string | { name?: string; displayName?: string; firstName?: string };
  consumer?: { displayName?: string; name?: string };
  date?: string;
  createdAt?: string;
  publishedDate?: string;
  datePublished?: string;
  [key: string]: unknown;
}

interface TreatwellVenueData {
  averageRating?: number;
  rating?: number;
  score?: number;
  totalReviews?: number;
  reviewCount?: number;
  numberOfReviews?: number;
  reviewsCount?: number;
  reviews?: TreatwellNextDataReview[];
  ratings?: { average?: number; count?: number };
  [key: string]: unknown;
}

export class TreatwellParser extends ReviewParserBase {
  async parse(url: string): Promise<ParsedReviews> {
    // Stap 1: Haal zoekresultaten op
    const { html: searchHtml } = await this.scraper.fetchWithPlaywright(url, 30000);

    // Stap 2: Zoek de eerste salon detail-URL in de zoekresultaten
    const detailUrl = this.extractDetailUrl(searchHtml);
    if (!detailUrl) {
      return { reviews: [] };
    }

    // Stap 3: Probeer __NEXT_DATA__ extractie via Playwright
    try {
      const result = await this.parseFromNextData(detailUrl);
      if (result) return result;
    } catch (error) {
      console.warn('[Treatwell] __NEXT_DATA__ extractie mislukt, fallback naar DOM/regex:', error);
    }

    // Stap 4: Fallback naar DOM extractie via Playwright
    try {
      const result = await this.parseFromDom(detailUrl);
      if (result && (result.reviews.length > 0 || result.averageRating !== undefined)) {
        return result;
      }
    } catch (error) {
      console.warn('[Treatwell] DOM extractie mislukt, fallback naar regex:', error);
    }

    // Stap 5: Laatste fallback: regex op HTML
    const { html } = await this.scraper.fetchWithPlaywright(detailUrl, 30000);
    return this.parseFromHtml(html);
  }

  /**
   * Extraheert de eerste salon detail-URL uit zoekresultaten.
   * Zoekt naar links met /salon/ in het href-attribuut.
   */
  extractDetailUrl(html: string): string | null {
    // Absolute URL
    const absoluteMatch = html.match(/href="(https?:\/\/www\.treatwell\.nl\/salon\/[^"]+)"/);
    if (absoluteMatch) {
      return this.decodeHtmlEntities(absoluteMatch[1]);
    }

    // Relatieve URL
    const match = html.match(/href="(\/salon\/[^"]+)"/);
    if (match) {
      return `https://www.treatwell.nl${this.decodeHtmlEntities(match[1])}`;
    }

    return null;
  }

  /**
   * Primaire aanpak: extraheert reviews via __NEXT_DATA__ JSON uit de Next.js pagina.
   * Retourneert null als __NEXT_DATA__ niet gevonden of niet bruikbaar is.
   */
  private async parseFromNextData(url: string): Promise<ParsedReviews | null> {
    const { result: nextDataJson } = await this.scraper.fetchWithPlaywrightCustom<string | null>(
      url,
      async (page) => {
        return page.evaluate(() => document.getElementById('__NEXT_DATA__')?.textContent ?? null);
      },
      30000,
    );

    if (!nextDataJson) return null;

    let nextData: Record<string, unknown>;
    try {
      nextData = JSON.parse(nextDataJson);
    } catch {
      console.warn('[Treatwell] __NEXT_DATA__ JSON parse mislukt');
      return null;
    }

    // Zoek venue/salon data met rating informatie
    const venueData = this.findVenueData(nextData);
    const averageRating = this.extractNextDataRating(nextData, venueData);
    const totalReviews = this.extractNextDataTotalReviews(nextData, venueData);
    const reviewsRaw = this.findReviews(nextData);

    if (reviewsRaw === null && averageRating === undefined && totalReviews === undefined) {
      console.warn('[Treatwell] Geen bruikbare data gevonden in __NEXT_DATA__');
      return null;
    }

    const reviews = this.mapNextDataReviews(reviewsRaw ?? []);

    return {
      averageRating,
      totalReviews,
      reviews: this.selectRandom(reviews),
    };
  }

  /**
   * Fallback 1: extraheert reviews uit de gerenderde DOM via page.evaluate().
   */
  private async parseFromDom(url: string): Promise<ParsedReviews | null> {
    const { result } = await this.scraper.fetchWithPlaywrightCustom<{
      averageRating?: number;
      totalReviews?: number;
      reviews: Array<{ author?: string; rating?: number; text?: string; date?: string }>;
    }>(
      url,
      async (page) => {
        // Wacht tot de pagina geladen is en scroll om lazy-loaded reviews te triggeren
        await page.waitForLoadState('networkidle').catch(() => {});

        return page.evaluate(() => {
          const result: {
            averageRating?: number;
            totalReviews?: number;
            reviews: Array<{ author?: string; rating?: number; text?: string; date?: string }>;
          } = { reviews: [] };

          // Zoek rating op pagina
          const ratingSelectors = [
            '[data-testid*="rating"]',
            '[class*="rating"]',
            '[class*="score"]',
            '[itemprop="ratingValue"]',
          ];
          for (const sel of ratingSelectors) {
            const el = document.querySelector(sel);
            if (el?.textContent) {
              const val = parseFloat(el.textContent.replace(',', '.').trim());
              if (!isNaN(val) && val >= 0 && val <= 5) {
                result.averageRating = val;
                break;
              }
            }
          }

          // Zoek totaal reviews
          const countSelectors = [
            '[data-testid*="review-count"]',
            '[itemprop="reviewCount"]',
          ];
          for (const sel of countSelectors) {
            const el = document.querySelector(sel);
            if (el?.textContent) {
              const match = el.textContent.match(/([\d.,]+)/);
              if (match) {
                const val = parseInt(match[1].replace(/[.,]/g, ''), 10);
                if (!isNaN(val)) {
                  result.totalReviews = val;
                  break;
                }
              }
            }
          }

          // Zoek review-elementen via diverse patronen
          const reviewSelectors = [
            '[role="article"]',
            '[data-testid*="review"]',
            '[class*="review-card"]',
            '[class*="review-item"]',
            '[class*="ReviewCard"]',
            '[itemtype*="Review"]',
          ];

          let reviewElements: Element[] = [];
          for (const sel of reviewSelectors) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
              reviewElements = Array.from(els);
              break;
            }
          }

          for (const el of reviewElements) {
            const textEl = el.querySelector(
              '[class*="review-text"], [class*="review-body"], [class*="review-content"], [itemprop="reviewBody"], p'
            );
            const text = textEl?.textContent?.trim();
            if (!text) continue;

            const authorEl = el.querySelector(
              '[class*="author"], [class*="name"], [itemprop="author"], [class*="reviewer"]'
            );
            const author = authorEl?.textContent?.trim() || undefined;

            let rating: number | undefined;
            const ratingEl = el.querySelector(
              '[data-rating], [class*="rating"], [itemprop="ratingValue"], [class*="stars"]'
            );
            if (ratingEl) {
              const dataRating = ratingEl.getAttribute('data-rating');
              if (dataRating) {
                rating = parseFloat(dataRating);
              } else if (ratingEl.textContent) {
                const val = parseFloat(ratingEl.textContent.replace(',', '.').trim());
                if (!isNaN(val) && val >= 0 && val <= 5) rating = val;
              }
            }

            const dateEl = el.querySelector(
              'time, [class*="date"], [itemprop="datePublished"]'
            );
            const date = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || undefined;

            result.reviews.push({ author, rating, text, date });
          }

          return result;
        });
      },
      30000,
    );

    if (!result) return null;

    return {
      averageRating: result.averageRating,
      totalReviews: result.totalReviews,
      reviews: this.selectRandom(
        result.reviews
          .filter((r) => r.text)
          .map((r) => ({
            author: r.author || undefined,
            rating: r.rating,
            text: r.text!,
            date: r.date || undefined,
          }))
      ),
    };
  }

  /**
   * Fallback 2: parset reviews uit HTML met regex (originele methode).
   */
  private parseFromHtml(html: string): ParsedReviews {
    const averageRating = this.extractAverageRating(html);
    const totalReviews = this.extractTotalReviews(html);
    const reviews = this.extractReviews(html);

    return {
      averageRating,
      totalReviews,
      reviews: this.selectRandom(reviews),
    };
  }

  // --- __NEXT_DATA__ helpers ---

  /**
   * Zoekt recursief naar venue/salon data in de __NEXT_DATA__ structuur.
   */
  private findVenueData(data: unknown): TreatwellVenueData | undefined {
    // Zoek naar bekende keys die venue-data bevatten
    const venueKeys = ['venue', 'salon', 'shop', 'business', 'establishment'];
    const found = this.deepFindByKeys(data, venueKeys);
    if (found && typeof found === 'object') {
      return found as TreatwellVenueData;
    }

    // Zoek naar object met averageRating of rating + reviewCount
    const ratingObj = this.deepFind(data, 'averageRating');
    if (ratingObj) return ratingObj as TreatwellVenueData;

    const ratingObj2 = this.deepFind(data, 'reviewCount');
    if (ratingObj2) return ratingObj2 as TreatwellVenueData;

    return undefined;
  }

  /**
   * Extraheert de gemiddelde rating uit __NEXT_DATA__.
   */
  private extractNextDataRating(data: unknown, venueData?: TreatwellVenueData): number | undefined {
    // Probeer venueData eerst
    if (venueData) {
      if (typeof venueData.averageRating === 'number') return venueData.averageRating;
      if (typeof venueData.rating === 'number') return venueData.rating;
      if (typeof venueData.score === 'number') return venueData.score;
      if (venueData.ratings?.average !== undefined) return venueData.ratings.average;
    }

    // Recursief zoeken
    for (const key of ['averageRating', 'rating', 'score', 'trustScore']) {
      const obj = this.deepFind(data, key);
      if (obj && typeof obj === 'object') {
        const val = (obj as Record<string, unknown>)[key];
        if (typeof val === 'number' && val >= 0 && val <= 5) return val;
      }
    }

    return undefined;
  }

  /**
   * Extraheert het totaal aantal reviews uit __NEXT_DATA__.
   */
  private extractNextDataTotalReviews(data: unknown, venueData?: TreatwellVenueData): number | undefined {
    if (venueData) {
      if (typeof venueData.totalReviews === 'number') return venueData.totalReviews;
      if (typeof venueData.reviewCount === 'number') return venueData.reviewCount;
      if (typeof venueData.numberOfReviews === 'number') return venueData.numberOfReviews;
      if (typeof venueData.reviewsCount === 'number') return venueData.reviewsCount;
      if (venueData.ratings?.count !== undefined) return venueData.ratings.count;
    }

    for (const key of ['totalReviews', 'reviewCount', 'numberOfReviews', 'reviewsCount']) {
      const obj = this.deepFind(data, key);
      if (obj && typeof obj === 'object') {
        const val = (obj as Record<string, unknown>)[key];
        if (typeof val === 'number') return val;
      }
    }

    return undefined;
  }

  /**
   * Zoekt de reviews array in de __NEXT_DATA__ structuur.
   */
  private findReviews(data: unknown): TreatwellNextDataReview[] | null {
    // Bekende paden proberen
    const props = data as Record<string, unknown>;
    const paths = [
      (props?.pageProps as Record<string, unknown>)?.reviews,
      (props?.props as Record<string, unknown>)?.pageProps &&
        ((props.props as Record<string, unknown>).pageProps as Record<string, unknown>)?.reviews,
    ];

    for (const candidate of paths) {
      if (Array.isArray(candidate) && candidate.length > 0) {
        return candidate;
      }
    }

    // Recursief zoeken naar array met review-achtige objecten
    const found = this.deepFindArray(data, (item) =>
      typeof item === 'object' &&
      item !== null &&
      (('text' in item || 'comment' in item || 'body' in item) &&
       ('rating' in item || 'score' in item || 'author' in item || 'user' in item || 'consumer' in item))
    );

    return found;
  }

  /**
   * Mapt __NEXT_DATA__ review objecten naar het Review formaat.
   */
  private mapNextDataReviews(rawReviews: TreatwellNextDataReview[]): Review[] {
    return rawReviews
      .filter((r) => r.text || r.comment || r.body || r.title)
      .map((r) => ({
        author: this.extractReviewAuthor(r),
        rating: this.extractReviewRating(r),
        text: this.extractReviewText(r),
        date: r.date ?? r.createdAt ?? r.publishedDate ?? r.datePublished ?? undefined,
      }))
      .filter((r) => !!r.text) as Review[];
  }

  private extractReviewAuthor(r: TreatwellNextDataReview): string | undefined {
    if (r.consumer?.displayName) return r.consumer.displayName;
    if (r.consumer?.name) return r.consumer.name;
    if (typeof r.author === 'string') return r.author;
    if (typeof r.author === 'object' && r.author !== null) {
      return r.author.displayName ?? r.author.name ?? r.author.firstName ?? undefined;
    }
    if (typeof r.name === 'string') return r.name;
    if (typeof r.user === 'string') return r.user;
    if (typeof r.user === 'object' && r.user !== null) {
      return r.user.displayName ?? r.user.name ?? r.user.firstName ?? undefined;
    }
    return undefined;
  }

  private extractReviewRating(r: TreatwellNextDataReview): number | undefined {
    if (typeof r.rating === 'number') return r.rating;
    if (typeof r.score === 'number') return r.score;
    return undefined;
  }

  private extractReviewText(r: TreatwellNextDataReview): string {
    const parts = [r.title, r.text ?? r.comment ?? r.body].filter(Boolean);
    return parts.join(' - ');
  }

  // --- Recursive search helpers ---

  /**
   * Zoekt recursief naar een key in een genest object.
   * Retourneert het parent-object dat de key bevat.
   */
  private deepFind(obj: unknown, key: string, depth = 0): unknown {
    if (depth > 8 || obj === null || typeof obj !== 'object') return undefined;

    const record = obj as Record<string, unknown>;
    if (key in record) return record;

    for (const value of Object.values(record)) {
      const found = this.deepFind(value, key, depth + 1);
      if (found) return found;
    }

    return undefined;
  }

  /**
   * Zoekt recursief naar een object met een van de gegeven keys.
   */
  private deepFindByKeys(obj: unknown, keys: string[], depth = 0): unknown {
    if (depth > 8 || obj === null || typeof obj !== 'object') return undefined;

    const record = obj as Record<string, unknown>;
    for (const key of keys) {
      if (key in record && typeof record[key] === 'object' && record[key] !== null) {
        return record[key];
      }
    }

    for (const value of Object.values(record)) {
      const found = this.deepFindByKeys(value, keys, depth + 1);
      if (found) return found;
    }

    return undefined;
  }

  /**
   * Zoekt recursief naar een array met items die aan het predikaat voldoen.
   */
  private deepFindArray(
    obj: unknown,
    predicate: (item: unknown) => boolean,
    depth = 0,
  ): TreatwellNextDataReview[] | null {
    if (depth > 8 || obj === null || typeof obj !== 'object') return null;

    if (Array.isArray(obj) && obj.length > 0 && obj.some(predicate)) {
      return obj;
    }

    const record = obj as Record<string, unknown>;
    for (const value of Object.values(record)) {
      const found = this.deepFindArray(value, predicate, depth + 1);
      if (found) return found;
    }

    return null;
  }

  // --- Regex fallback helpers (originele methodes) ---

  private extractAverageRating(html: string): number | undefined {
    const ratingValueMatch = html.match(/class="[^"]*rating-value[^"]*"[^>]*>([\s\S]*?)<\//);
    if (ratingValueMatch) {
      const val = parseFloat(ratingValueMatch[1].replace(',', '.').trim());
      if (!isNaN(val) && val >= 0 && val <= 5) return val;
    }

    const dataRatingMatch = html.match(/data-rating="([\d.,]+)"/);
    if (dataRatingMatch) {
      const val = parseFloat(dataRatingMatch[1].replace(',', '.'));
      if (val >= 0 && val <= 5) return val;
    }

    return undefined;
  }

  private extractTotalReviews(html: string): number | undefined {
    const match = html.match(/([\d.,]+)\s*beoordelingen/i);
    if (match) {
      return this.parseReviewCount(match[0]);
    }
    return undefined;
  }

  private extractReviews(html: string): Review[] {
    const reviews: Review[] = [];

    const cardPattern = /<div[^>]*class="[^"]*(?:review-card|review-item)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:review-card|review-item)[^"]*"|$)/gi;
    const cards = html.match(cardPattern);

    if (!cards) return reviews;

    for (const card of cards) {
      const review = this.parseReviewCard(card);
      if (review) reviews.push(review);
    }

    return reviews;
  }

  private parseReviewCard(card: string): Review | null {
    const text = this.extractCardText(card);
    if (!text) return null;

    return {
      author: this.extractCardAuthor(card),
      rating: this.extractCardRating(card),
      text,
      date: this.extractCardDate(card),
    };
  }

  private extractCardText(card: string): string | undefined {
    const match = card.match(/class="[^"]*(?:review-text|review-body|review-content)[^"]*"[^>]*>([\s\S]*?)<\//);
    if (match) {
      const text = this.stripTags(match[1]).trim();
      return text || undefined;
    }
    return undefined;
  }

  private extractCardRating(card: string): number | undefined {
    const match = card.match(/data-rating="([\d.,]+)"/);
    if (match) {
      const val = parseFloat(match[1].replace(',', '.'));
      if (val >= 0 && val <= 5) return val;
    }
    return undefined;
  }

  private extractCardAuthor(card: string): string | undefined {
    const match = card.match(/class="[^"]*(?:review-author|review-name)[^"]*"[^>]*>([\s\S]*?)<\//);
    if (match) {
      const name = this.stripTags(match[1]).trim();
      return name || undefined;
    }
    return undefined;
  }

  private extractCardDate(card: string): string | undefined {
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
