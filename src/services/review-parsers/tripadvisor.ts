import { Review } from '../../types/customer-reviews';
import { ReviewParserBase, ParsedReviews } from './base';

export class TripadvisorParser extends ReviewParserBase {
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
    // Patroon: data-rating="4.5"
    const dataRatingMatch = html.match(/data-rating="([\d.,]+)"/);
    if (dataRatingMatch) {
      const val = parseFloat(dataRatingMatch[1].replace(',', '.'));
      if (val >= 0 && val <= 5) return val;
    }

    // Patroon: "4.5 of 5 bubbles"
    const bubblesMatch = html.match(/([\d.,]+)\s+of\s+5\s+bubbles/i);
    if (bubblesMatch) {
      return parseFloat(bubblesMatch[1].replace(',', '.'));
    }

    return undefined;
  }

  private extractTotalReviews(html: string): number | undefined {
    // Patroon: "2.345 reviews" of "2.345 beoordelingen"
    const match = html.match(/([\d.,]+)\s*(?:reviews?|beoordelingen)/i);
    if (match) {
      return this.parseReviewCount(match[0]);
    }
    return undefined;
  }

  private extractReviews(html: string): Review[] {
    const reviews: Review[] = [];

    // Zoek review-blokken via data-test-target="HR_CC_CARD" of review-container
    const cardPattern = /(?:data-test-target="HR_CC_CARD"|class="[^"]*review-container[^"]*")([\s\S]*?)(?=data-test-target="HR_CC_CARD"|class="[^"]*review-container[^"]*"|$)/gi;
    const cards = html.match(cardPattern);

    if (!cards || cards.length === 0) {
      // Fallback: splits op review-container divs
      const fallbackPattern = /<div[^>]*class="[^"]*review-container[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*review-container|$)/gi;
      const fallbackCards = html.match(fallbackPattern);
      if (fallbackCards) {
        for (const card of fallbackCards) {
          const review = this.parseReviewCard(card);
          if (review) reviews.push(review);
        }
      }
      return reviews;
    }

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
    // data-test-target="review-body"
    const bodyMatch = card.match(/data-test-target="review-body"[^>]*>([\s\S]*?)<\//);
    if (bodyMatch) return this.stripTags(bodyMatch[1]).trim();

    // class="partial_entry"
    const partialMatch = card.match(/class="[^"]*partial_entry[^"]*"[^>]*>([\s\S]*?)<\//);
    if (partialMatch) return this.stripTags(partialMatch[1]).trim();

    return undefined;
  }

  private extractCardRating(card: string): number | undefined {
    // title="4 of 5 bubbles"
    const titleMatch = card.match(/title="(\d+)\s+of\s+5\s+bubbles"/i);
    if (titleMatch) return parseInt(titleMatch[1], 10);

    // class="bubble_40" => 4.0
    const bubbleMatch = card.match(/bubble_(\d)(\d)/);
    if (bubbleMatch) {
      return parseInt(bubbleMatch[1], 10) + parseInt(bubbleMatch[2], 10) / 10;
    }

    // class="bubble_4" => 4
    const bubbleSingle = card.match(/bubble_(\d)(?!\d)/);
    if (bubbleSingle) return parseInt(bubbleSingle[1], 10);

    return undefined;
  }

  private extractAuthor(card: string): string | undefined {
    const match = card.match(/class="[^"]*username[^"]*"[^>]*>([\s\S]*?)<\//);
    if (match) return this.stripTags(match[1]).trim() || undefined;
    return undefined;
  }

  private extractDate(card: string): string | undefined {
    // class="ratingDate" met title attribuut
    const match = card.match(/class="[^"]*ratingDate[^"]*"[^>]*title="([^"]+)"/);
    if (match) return match[1].trim();

    // Fallback: ratingDate inhoud
    const contentMatch = card.match(/class="[^"]*ratingDate[^"]*"[^>]*>([\s\S]*?)<\//);
    if (contentMatch) return this.stripTags(contentMatch[1]).trim() || undefined;

    return undefined;
  }

  private stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  }
}
