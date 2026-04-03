import { Review } from '../../types/customer-reviews';
import { ScraperService } from '../scraper';

export interface ParsedReviews {
  averageRating?: number;
  totalReviews?: number;
  reviews: Review[];
}

export abstract class ReviewParserBase {
  constructor(protected scraper: ScraperService) {}

  abstract parse(url: string): Promise<ParsedReviews>;

  /**
   * Selecteert willekeurig max N reviews via Fisher-Yates shuffle.
   */
  selectRandom(reviews: Review[], max = 10): Review[] {
    if (reviews.length <= max) return [...reviews];

    const shuffled = [...reviews];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, max);
  }

  /**
   * Extraheert een rating uit tekst zoals "4.5/5", "4,5", "4.5 stars", "4.5 sterren".
   */
  parseRating(text: string): number | undefined {
    if (!text) return undefined;

    // Formaat: "4.5/5" of "4,5/5"
    const slashMatch = text.match(/(\d+[.,]\d+)\s*\/\s*5/);
    if (slashMatch) {
      return parseFloat(slashMatch[1].replace(',', '.'));
    }

    // Formaat: "4.5 stars" of "4,5 sterren"
    const starsMatch = text.match(/(\d+[.,]\d+)\s*(?:stars?|sterren?)/i);
    if (starsMatch) {
      return parseFloat(starsMatch[1].replace(',', '.'));
    }

    // Formaat: enkel "4.5" of "4,5" (los getal met decimaal)
    const decimalMatch = text.match(/(\d+[.,]\d+)/);
    if (decimalMatch) {
      const value = parseFloat(decimalMatch[1].replace(',', '.'));
      if (value >= 0 && value <= 5) return value;
    }

    // Geheel getal (bijv. "4" of "5")
    const intMatch = text.match(/(\d+)/);
    if (intMatch) {
      const value = parseInt(intMatch[1], 10);
      if (value >= 0 && value <= 5) return value;
    }

    return undefined;
  }

  /**
   * Extraheert een review-aantal uit tekst zoals "1.234 reviews", "1,234 beoordelingen".
   */
  parseReviewCount(text: string): number | undefined {
    if (!text) return undefined;

    // Match getallen met punt of komma als duizendtal-scheider
    // Bijv. "1.234 reviews", "1,234 beoordelingen", "12345 reviews"
    const countMatch = text.match(/([\d.,]+)\s*(?:reviews?|beoordelingen|ratings?|recens[ai]es?)/i);
    if (countMatch) {
      return this.parseNumber(countMatch[1]);
    }

    // Fallback: zoek naar getal gevolgd door relevante woorden
    const fallbackMatch = text.match(/([\d.,]+)\s*(?:Google\s*)?(?:reviews?|beoordelingen)/i);
    if (fallbackMatch) {
      return this.parseNumber(fallbackMatch[1]);
    }

    return undefined;
  }

  private parseNumber(numStr: string): number | undefined {
    // Bepaal of punt of komma de duizendtal-scheider is
    // "1.234" (NL) = 1234, "1,234" (EN) = 1234
    const cleaned = numStr
      .replace(/\./g, '')  // Verwijder punten (NL duizendtallen)
      .replace(/,/g, '');  // Verwijder komma's (EN duizendtallen)

    const value = parseInt(cleaned, 10);
    return isNaN(value) ? undefined : value;
  }
}
