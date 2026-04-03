import { Review } from '../../types/customer-reviews';
import { ReviewParserBase, ParsedReviews } from './base';

export class YelpParser extends ReviewParserBase {
  async parse(url: string): Promise<ParsedReviews> {
    // Stap 1: Haal zoekresultaten op
    const { html: searchHtml } = await this.scraper.fetchWithPlaywright(url, 30000);

    // Stap 2: Zoek de eerste business detail URL in de zoekresultaten
    const detailUrl = this.extractDetailUrl(searchHtml);
    if (!detailUrl) {
      return { reviews: [] };
    }

    // Stap 3: Haal de business detail pagina op
    const { html } = await this.scraper.fetchWithPlaywright(detailUrl, 30000);

    // Stap 4: Extraheer reviews van de detail pagina
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
   * Extraheert de eerste business detail URL uit Yelp zoekresultaten.
   * Zoekt naar links met /biz/ in het href attribuut.
   */
  extractDetailUrl(html: string): string | undefined {
    const bizLinkRegex = /href=["']([^"']*\/biz\/[^"']+)["']/gi;
    let match: RegExpExecArray | null;

    while ((match = bizLinkRegex.exec(html)) !== null) {
      const href = match[1];
      // Skip advertentie-links en adrenaline/non-business links
      if (href.includes('/biz_photos/') || href.includes('/biz_redir')) continue;
      return this.resolveUrl(href);
    }

    return undefined;
  }

  private resolveUrl(url: string): string {
    const decoded = this.decodeHtmlEntities(url);
    if (decoded.startsWith('http')) return decoded;
    return `https://www.yelp.com${decoded.startsWith('/') ? '' : '/'}${decoded}`;
  }

  /**
   * Extraheert gemiddelde rating uit Yelp HTML.
   * Zoekt naar aria-label="X star rating" patroon.
   */
  extractAverageRating(html: string): number | undefined {
    const match = html.match(/aria-label=["'](\d+(?:[.,]\d+)?)\s*star\s*rating["']/i);
    if (match) {
      return parseFloat(match[1].replace(',', '.'));
    }
    return undefined;
  }

  /**
   * Extraheert totaal aantal reviews uit Yelp HTML.
   */
  extractTotalReviews(html: string): number | undefined {
    return this.parseReviewCount(html);
  }

  /**
   * Extraheert individuele reviews uit Yelp HTML.
   * Zoekt naar blokken met review__ class prefix.
   */
  extractReviews(html: string): Review[] {
    const reviews: Review[] = [];

    // Split op review blokken met review__ class prefix
    const reviewBlockRegex = /class=["'][^"']*review__[^"']*["'][^>]*>([\s\S]*?)(?=class=["'][^"']*review__[^"']*["']|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = reviewBlockRegex.exec(html)) !== null) {
      const block = match[1];
      const review = this.parseReviewBlock(block);
      if (review) reviews.push(review);
    }

    return reviews;
  }

  private parseReviewBlock(block: string): Review | undefined {
    // Tekst: class="comment" of <p lang="...">
    let text: string | undefined;

    const commentMatch = block.match(/class=["'][^"']*comment[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (commentMatch) {
      text = this.stripTags(commentMatch[1]).trim();
    }

    if (!text) {
      const pLangMatch = block.match(/<p\s+lang=["'][^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
      if (pLangMatch) {
        text = this.stripTags(pLangMatch[1]).trim();
      }
    }

    if (!text) return undefined;

    // Rating: aria-label="X star"
    let rating: number | undefined;
    const ratingMatch = block.match(/aria-label=["'](\d+(?:[.,]\d+)?)\s*star["']/i);
    if (ratingMatch) {
      rating = parseFloat(ratingMatch[1].replace(',', '.'));
    }

    // Auteur: user-passport class met geneste <a>
    let author: string | undefined;
    const passportMatch = block.match(/class=["'][^"']*user-passport[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (passportMatch) {
      const anchorMatch = passportMatch[1].match(/<a[^>]*>([^<]+)<\/a>/i);
      if (anchorMatch) {
        author = anchorMatch[1].trim();
      }
    }

    // Datum: MM/DD/YYYY patroon
    let date: string | undefined;
    const dateMatch = block.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (dateMatch) {
      date = dateMatch[1];
    }

    return { author, rating, text, date };
  }

  private stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '');
  }
}
