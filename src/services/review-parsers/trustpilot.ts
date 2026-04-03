import { Review } from '../../types/customer-reviews';
import { ReviewParserBase, ParsedReviews } from './base';

export class TrustpilotParser extends ReviewParserBase {
  async parse(url: string): Promise<ParsedReviews> {
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
