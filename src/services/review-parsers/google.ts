import { Review } from '../../types/customer-reviews';
import { ReviewParserBase, ParsedReviews } from './base';

export class GoogleReviewsParser extends ReviewParserBase {
  async parse(url: string): Promise<ParsedReviews> {
    const { html } = await this.scraper.fetchWithPlaywright(url, 20000);

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
