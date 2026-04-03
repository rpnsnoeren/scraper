import { Review } from '../../types/customer-reviews';
import { ReviewParserBase, ParsedReviews } from './base';

export class ExpediaParser extends ReviewParserBase {
  async parse(url: string): Promise<ParsedReviews> {
    const { html } = await this.scraper.fetchWithPlaywright(url, 30000);
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
   * Extraheert gemiddelde rating uit Expedia HTML.
   * Ondersteunt formaten: "4.2/5", "4.2 out of 5", "8.4/10" (gedeeld door 2).
   */
  extractAverageRating(html: string): number | undefined {
    // Formaat: "X/10" — converteer naar 5-schaal
    const tenScaleMatch = html.match(/(\d+[.,]\d+)\s*\/\s*10/);
    if (tenScaleMatch) {
      const value = parseFloat(tenScaleMatch[1].replace(',', '.'));
      return Math.round((value / 2) * 10) / 10;
    }

    // Formaat: "X/5"
    const fiveScaleMatch = html.match(/(\d+[.,]\d+)\s*\/\s*5/);
    if (fiveScaleMatch) {
      return parseFloat(fiveScaleMatch[1].replace(',', '.'));
    }

    // Formaat: "X out of 5"
    const outOfMatch = html.match(/(\d+[.,]\d+)\s*out\s+of\s+5/i);
    if (outOfMatch) {
      return parseFloat(outOfMatch[1].replace(',', '.'));
    }

    return undefined;
  }

  /**
   * Extraheert totaal aantal reviews uit Expedia HTML.
   */
  extractTotalReviews(html: string): number | undefined {
    // "X verified reviews"
    const verifiedMatch = html.match(/([\d.,]+)\s*verified\s*reviews?/i);
    if (verifiedMatch) {
      return this.parseReviewCount(`${verifiedMatch[1]} reviews`);
    }

    // Gebruik de base parseReviewCount voor "reviews" en "beoordelingen"
    return this.parseReviewCount(html);
  }

  /**
   * Extraheert individuele reviews uit Expedia HTML met structured data of data-stid attributen.
   */
  extractReviews(html: string): Review[] {
    const reviews: Review[] = [];

    // Probeer itemprop="review" blokken
    const reviewBlockRegex = /itemprop=["']review["'][^>]*>([\s\S]*?)(?=itemprop=["']review["']|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = reviewBlockRegex.exec(html)) !== null) {
      const block = match[1];
      const review = this.parseReviewBlock(block);
      if (review) reviews.push(review);
    }

    // Als geen itemprop reviews gevonden, probeer data-stid="review-card"
    if (reviews.length === 0) {
      const cardRegex = /data-stid=["']review-card["'][^>]*>([\s\S]*?)(?=data-stid=["']review-card["']|$)/gi;
      while ((match = cardRegex.exec(html)) !== null) {
        const block = match[1];
        const review = this.parseReviewBlock(block);
        if (review) reviews.push(review);
      }
    }

    return reviews;
  }

  private parseReviewBlock(block: string): Review | undefined {
    // Tekst: itemprop="description"
    const textMatch = block.match(/itemprop=["']description["'][^>]*>([^<]+)/i);
    if (!textMatch) return undefined;

    const text = textMatch[1].trim();
    if (!text) return undefined;

    // Rating: itemprop="ratingValue" content="X"
    let rating: number | undefined;
    const ratingMatch = block.match(/itemprop=["']ratingValue["']\s*content=["']([^"']+)["']/i);
    if (ratingMatch) {
      rating = parseFloat(ratingMatch[1]);
      if (rating > 5) rating = Math.round((rating / 2) * 10) / 10;
    }

    // Auteur: itemprop="author"
    let author: string | undefined;
    const authorMatch = block.match(/itemprop=["']author["'][^>]*>([^<]+)/i);
    if (authorMatch) {
      author = authorMatch[1].trim();
    }

    // Datum: itemprop="datePublished" content="X"
    let date: string | undefined;
    const dateMatch = block.match(/itemprop=["']datePublished["']\s*content=["']([^"']+)["']/i);
    if (dateMatch) {
      date = dateMatch[1].trim();
    }

    return { author, rating, text, date };
  }
}
