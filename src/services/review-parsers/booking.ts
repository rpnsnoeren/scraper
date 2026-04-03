import { Review } from '../../types/customer-reviews';
import { ReviewParserBase, ParsedReviews } from './base';

export class BookingParser extends ReviewParserBase {
  async parse(url: string): Promise<ParsedReviews> {
    // Stap 1: Haal zoekresultaten op
    const { html: searchHtml } = await this.scraper.fetchWithPlaywright(url, 30000);

    // Stap 2: Zoek de eerste hotel detail-URL in de zoekresultaten
    const detailUrl = this.extractDetailUrl(searchHtml);
    if (!detailUrl) {
      return { reviews: [] };
    }

    // Stap 3: Haal de hotel detailpagina op (met #tab-reviews voor reviews sectie)
    const reviewUrl = detailUrl.includes('#') ? detailUrl : `${detailUrl}#tab-reviews`;
    const { html } = await this.scraper.fetchWithPlaywright(reviewUrl, 30000);

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
