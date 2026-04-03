import { Review } from '../../types/customer-reviews';
import { ReviewParserBase, ParsedReviews } from './base';

export class TreatwellParser extends ReviewParserBase {
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

  private extractAverageRating(html: string): number | undefined {
    // class="rating-value"
    const ratingValueMatch = html.match(/class="[^"]*rating-value[^"]*"[^>]*>([\s\S]*?)<\//);
    if (ratingValueMatch) {
      const val = parseFloat(ratingValueMatch[1].replace(',', '.').trim());
      if (!isNaN(val) && val >= 0 && val <= 5) return val;
    }

    // data-rating attribuut
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

    // Zoek review-blokken via review-card of review-item class
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
    const text = this.extractReviewText(card);
    if (!text) return null;

    return {
      author: this.extractAuthor(card),
      rating: this.extractCardRating(card),
      text,
      date: this.extractDate(card),
    };
  }

  private extractReviewText(card: string): string | undefined {
    // Zoek review-text, review-body, of review-content class
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

  private extractAuthor(card: string): string | undefined {
    const match = card.match(/class="[^"]*(?:review-author|review-name)[^"]*"[^>]*>([\s\S]*?)<\//);
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
