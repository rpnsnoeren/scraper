import { Review } from '../../types/customer-reviews';
import { ReviewParserBase, ParsedReviews } from './base';

interface NextDataReview {
  text?: string;
  title?: string;
  rating?: number;
  consumer?: { displayName?: string };
  dates?: { publishedDate?: string; experiencedDate?: string };
  createdAt?: string;
}

interface NextDataBusinessUnit {
  trustScore?: number;
  numberOfReviews?: number;
}

interface NextDataProps {
  pageProps?: {
    businessUnit?: NextDataBusinessUnit;
    reviews?: NextDataReview[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class TrustpilotParser extends ReviewParserBase {
  private static readonly MAX_PAGES = 3;

  async parse(url: string): Promise<ParsedReviews> {
    // Primaire aanpak: __NEXT_DATA__ JSON extractie
    try {
      const result = await this.parseFromNextData(url);
      if (result) return result;
    } catch (error) {
      console.warn('[Trustpilot] __NEXT_DATA__ extractie mislukt, fallback naar regex:', error);
    }

    // Fallback: regex extractie uit HTML
    return this.parseFromHtml(url);
  }

  /**
   * Extraheert reviews via __NEXT_DATA__ JSON uit de Next.js pagina.
   * Retourneert null als __NEXT_DATA__ niet gevonden of niet bruikbaar is.
   */
  private async parseFromNextData(url: string): Promise<ParsedReviews | null> {
    const { result: nextDataJson } = await this.scraper.fetchWithPlaywrightCustom<string | null>(
      url,
      async (page) => {
        return page.evaluate(() => document.getElementById('__NEXT_DATA__')?.textContent ?? null);
      },
      15000,
    );

    if (!nextDataJson) return null;

    let nextData: NextDataProps;
    try {
      nextData = JSON.parse(nextDataJson);
    } catch {
      console.warn('[Trustpilot] __NEXT_DATA__ JSON parse mislukt');
      return null;
    }

    const businessUnit = this.findBusinessUnit(nextData);
    const averageRating = businessUnit?.trustScore;
    const totalReviews = businessUnit?.numberOfReviews;
    const reviewsRaw = this.findReviews(nextData);

    if (reviewsRaw === null && averageRating === undefined && totalReviews === undefined) {
      console.warn('[Trustpilot] Geen bruikbare data gevonden in __NEXT_DATA__');
      return null;
    }

    let reviews = this.mapNextDataReviews(reviewsRaw ?? []);

    // Paginering: haal extra pagina's op als er meer reviews zijn
    if (totalReviews && reviews.length > 0 && totalReviews > reviews.length) {
      const baseUrl = url.split('?')[0];
      for (let page = 2; page <= TrustpilotParser.MAX_PAGES; page++) {
        try {
          const pageReviews = await this.fetchNextDataPage(`${baseUrl}?page=${page}`);
          if (pageReviews.length === 0) break;
          reviews = reviews.concat(pageReviews);
        } catch (error) {
          console.warn(`[Trustpilot] Pagina ${page} ophalen mislukt:`, error);
          break;
        }
      }
    }

    return {
      averageRating,
      totalReviews,
      reviews: this.selectRandom(reviews),
    };
  }

  /**
   * Haalt reviews op van een extra pagina via __NEXT_DATA__.
   */
  private async fetchNextDataPage(url: string): Promise<Review[]> {
    const { result: nextDataJson } = await this.scraper.fetchWithPlaywrightCustom<string | null>(
      url,
      async (page) => {
        return page.evaluate(() => document.getElementById('__NEXT_DATA__')?.textContent ?? null);
      },
      15000,
    );

    if (!nextDataJson) return [];

    try {
      const nextData: NextDataProps = JSON.parse(nextDataJson);
      const reviewsRaw = this.findReviews(nextData);
      return this.mapNextDataReviews(reviewsRaw ?? []);
    } catch {
      return [];
    }
  }

  /**
   * Zoekt de businessUnit in de __NEXT_DATA__ structuur.
   * Probeert bekende paden en zoekt recursief als fallback.
   */
  private findBusinessUnit(data: NextDataProps): NextDataBusinessUnit | undefined {
    // Bekende paden
    const paths = [
      data?.pageProps?.businessUnit,
      (data?.props as NextDataProps)?.pageProps?.businessUnit,
    ];

    for (const candidate of paths) {
      if (candidate && typeof candidate.trustScore === 'number') {
        return candidate;
      }
    }

    // Recursief zoeken naar een object met trustScore
    const found = this.deepFind(data, 'trustScore');
    if (found && typeof found === 'object' && 'trustScore' in found) {
      return found as NextDataBusinessUnit;
    }

    return undefined;
  }

  /**
   * Zoekt de reviews array in de __NEXT_DATA__ structuur.
   */
  private findReviews(data: NextDataProps): NextDataReview[] | null {
    // Bekende paden
    const paths = [
      data?.pageProps?.reviews,
      (data?.props as NextDataProps)?.pageProps?.reviews,
    ];

    for (const candidate of paths) {
      if (Array.isArray(candidate) && candidate.length > 0) {
        return candidate;
      }
    }

    // Recursief zoeken naar een array met review-achtige objecten
    const found = this.deepFindArray(data, (item) =>
      typeof item === 'object' && item !== null && ('text' in item || 'rating' in item) && ('consumer' in item || 'dates' in item)
    );

    return found;
  }

  /**
   * Zoekt recursief naar een key in een genest object.
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
   * Zoekt recursief naar een array met items die aan de predikaat voldoen.
   */
  private deepFindArray(obj: unknown, predicate: (item: unknown) => boolean, depth = 0): NextDataReview[] | null {
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

  /**
   * Mapt __NEXT_DATA__ review objecten naar het Review formaat.
   */
  private mapNextDataReviews(rawReviews: NextDataReview[]): Review[] {
    return rawReviews
      .filter((r) => r.text || r.title)
      .map((r) => ({
        author: r.consumer?.displayName || undefined,
        rating: typeof r.rating === 'number' ? r.rating : undefined,
        text: [r.title, r.text].filter(Boolean).join(' - '),
        date: r.dates?.publishedDate ?? r.dates?.experiencedDate ?? r.createdAt ?? undefined,
      }));
  }

  /**
   * Fallback: parst reviews uit HTML met regex.
   */
  private async parseFromHtml(url: string): Promise<ParsedReviews> {
    const { html } = await this.scraper.fetchWithPlaywright(url, 15000);

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
   * Extraheert de gemiddelde rating uit Trustpilot HTML.
   * Zoekt naar data-rating-typography of "TrustScore X.X".
   */
  private extractAverageRating(html: string): number | undefined {
    // Patroon 1: data-rating-typography="true">4.3</span>
    const ratingTypoMatch = html.match(
      /data-rating-typography="true"[^>]*>\s*([\d.,]+)\s*<\/span>/i
    );
    if (ratingTypoMatch) {
      return this.parseRating(ratingTypoMatch[1]);
    }

    // Patroon 2: TrustScore 4.3
    const trustScoreMatch = html.match(/TrustScore\s+([\d.,]+)/i);
    if (trustScoreMatch) {
      return this.parseRating(trustScoreMatch[1]);
    }

    return undefined;
  }

  /**
   * Extraheert het totaal aantal reviews.
   * Zoekt naar "1.234 beoordelingen" of "1,234 reviews".
   */
  private extractTotalReviews(html: string): number | undefined {
    // Trustpilot-specifiek: zoek rond review-count elementen
    const countMatch = html.match(
      /([\d.,]+)\s*(?:beoordelingen|reviews?|ratings?)/i
    );
    if (countMatch) {
      return this.parseReviewCount(countMatch[0]);
    }

    return undefined;
  }

  /**
   * Extraheert individuele reviews uit review cards.
   */
  private extractReviews(html: string): Review[] {
    const reviews: Review[] = [];

    // Split op review cards met data-service-review-card-paper
    const cardPattern = /data-service-review-card-paper[^>]*>([\s\S]*?)(?=data-service-review-card-paper|$)/g;
    let cardMatch: RegExpExecArray | null;

    while ((cardMatch = cardPattern.exec(html)) !== null) {
      const card = cardMatch[0];
      const review = this.parseCard(card);
      if (review) {
        reviews.push(review);
      }
    }

    return reviews;
  }

  /**
   * Parset een enkele review card.
   * Geeft null terug als er geen tekst gevonden is.
   */
  private parseCard(cardHtml: string): Review | null {
    // Rating: data-service-review-rating="4"
    const ratingMatch = cardHtml.match(/data-service-review-rating="(\d+)"/);
    const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : undefined;

    // Tekst: data-service-review-text-typography
    const textMatch = cardHtml.match(
      /data-service-review-text-typography[^>]*>([\s\S]*?)<\//
    );
    const text = textMatch ? this.stripHtml(textMatch[1]).trim() : '';

    // Geen tekst = geen bruikbare review
    if (!text) return null;

    // Auteur: data-consumer-name-typography
    const authorMatch = cardHtml.match(
      /data-consumer-name-typography[^>]*>([\s\S]*?)<\//
    );
    const author = authorMatch ? this.stripHtml(authorMatch[1]).trim() : undefined;

    // Datum: <time datetime="2025-01-15">
    const dateMatch = cardHtml.match(/<time\s+datetime="([^"]+)"/);
    const date = dateMatch ? dateMatch[1] : undefined;

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
