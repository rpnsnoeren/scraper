import { Page } from 'playwright';
import { Review } from '../../types/customer-reviews';
import { ReviewParserBase, ParsedReviews } from './base';

interface PlaywrightExtractedData {
  averageRating?: number;
  totalReviews?: number;
  reviews: Review[];
  graphqlReviews: Review[];
}

export class TripadvisorParser extends ReviewParserBase {
  async parse(url: string): Promise<ParsedReviews> {
    const { html: searchHtml } = await this.scraper.fetchWithPlaywright(url, 30000);

    // Stap 1: Zoek de detail-pagina URL uit de zoekresultaten
    const detailUrl = this.extractDetailUrl(searchHtml);

    // Stap 2: Als een detail URL gevonden is, gebruik Playwright custom voor interactie
    if (detailUrl) {
      try {
        const { result } = await this.scraper.fetchWithPlaywrightCustom<PlaywrightExtractedData>(
          detailUrl,
          (page) => this.extractFromDetailPage(page),
          45000,
        );

        // Combineer GraphQL en DOM reviews, GraphQL heeft prioriteit
        const reviews = result.graphqlReviews.length > 0
          ? result.graphqlReviews
          : result.reviews;

        return {
          averageRating: result.averageRating,
          totalReviews: result.totalReviews,
          reviews: this.selectRandom(reviews),
        };
      } catch {
        // Fallback naar regex-gebaseerde extractie
        const { html: detailHtml } = await this.scraper.fetchWithPlaywright(detailUrl, 30000);
        return this.extractFromHtml(detailHtml);
      }
    }

    // Geen detail URL gevonden — probeer huidige HTML
    return this.extractFromHtml(searchHtml);
  }

  /**
   * Extraheert reviews via Playwright page.evaluate() en response interception.
   */
  private async extractFromDetailPage(page: Page): Promise<PlaywrightExtractedData> {
    const graphqlReviews: Review[] = [];

    // Intercepteer GraphQL responses voor review data
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/data/graphql') || url.includes('ReviewList')) {
        try {
          const json = await response.json();
          const reviews = this.parseGraphqlResponse(json);
          if (reviews.length > 0) {
            graphqlReviews.push(...reviews);
          }
        } catch {
          // Niet-JSON response, negeren
        }
      }
    });

    // Scroll om lazy-loaded reviews te triggeren
    for (let i = 0; i < 3; i++) {
      await page.evaluate((step) => {
        window.scrollTo(0, document.body.scrollHeight * ((step + 1) / 4));
      }, i);
      await page.waitForTimeout(1500);
    }

    // Wacht even voor GraphQL responses
    await page.waitForTimeout(2000);

    // Extraheer data uit de DOM via page.evaluate
    const domData = await page.evaluate(() => {
      const result: {
        averageRating?: number;
        totalReviews?: number;
        reviews: Array<{
          author?: string;
          rating?: number;
          text?: string;
          date?: string;
        }>;
      } = { reviews: [] };

      // Gemiddelde rating
      const ratingEl = document.querySelector('[data-rating]');
      if (ratingEl) {
        const val = parseFloat(ratingEl.getAttribute('data-rating')?.replace(',', '.') || '');
        if (val >= 0 && val <= 5) result.averageRating = val;
      }
      if (!result.averageRating) {
        // Zoek "X of 5 bubbles" in aria-labels of titels
        const allEls = document.querySelectorAll('[aria-label], [title]');
        for (const el of allEls) {
          const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
          const match = label.match(/([\d.,]+)\s+of\s+5\s+bubbles/i);
          if (match) {
            const val = parseFloat(match[1].replace(',', '.'));
            if (val >= 0 && val <= 5) {
              result.averageRating = val;
              break;
            }
          }
        }
      }

      // Totaal aantal reviews
      const bodyText = document.body.innerText;
      const reviewCountMatch = bodyText.match(/([\d.,]+)\s*(?:reviews?|beoordelingen)/i);
      if (reviewCountMatch) {
        const cleaned = reviewCountMatch[1].replace(/\./g, '').replace(/,/g, '');
        const val = parseInt(cleaned, 10);
        if (!isNaN(val)) result.totalReviews = val;
      }

      // Review-kaarten — probeer diverse selectors
      const selectors = [
        '[data-automation="reviewCard"]',
        'div[data-review-id]',
        '[data-test-target="HR_CC_CARD"]',
        '.review-container',
      ];

      let cards: Element[] = [];
      for (const sel of selectors) {
        const found = document.querySelectorAll(sel);
        if (found.length > 0) {
          cards = Array.from(found);
          break;
        }
      }

      for (const card of cards) {
        // Rating: zoek in aria-labels en titles
        let rating: number | undefined;
        const ratingEls = card.querySelectorAll('[aria-label], [title], svg title');
        for (const el of ratingEls) {
          const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '';
          const bubbleMatch = label.match(/(\d+(?:\.\d+)?)\s+of\s+5\s+bubbles/i);
          if (bubbleMatch) {
            rating = parseFloat(bubbleMatch[1]);
            break;
          }
        }
        // Fallback: bubble_XX class
        if (!rating) {
          const bubbleEl = card.querySelector('[class*="bubble_"]');
          if (bubbleEl) {
            const cls = bubbleEl.className;
            const m = cls.match(/bubble_(\d)(\d)/);
            if (m) {
              rating = parseInt(m[1], 10) + parseInt(m[2], 10) / 10;
            } else {
              const m2 = cls.match(/bubble_(\d)(?!\d)/);
              if (m2) rating = parseInt(m2[1], 10);
            }
          }
        }

        // Tekst: zoek het langste tekstblok in de kaart
        let text: string | undefined;
        const reviewBody = card.querySelector('[data-test-target="review-body"]');
        if (reviewBody) {
          text = (reviewBody.textContent || '').trim();
        }
        if (!text) {
          const partialEntry = card.querySelector('.partial_entry');
          if (partialEntry) {
            text = (partialEntry.textContent || '').trim();
          }
        }
        if (!text) {
          // Fallback: langste tekst in <p> of <span> elementen
          const textEls = card.querySelectorAll('p, span, div');
          let longest = '';
          for (const el of textEls) {
            const t = (el.textContent || '').trim();
            if (t.length > longest.length && t.length > 20) {
              longest = t;
            }
          }
          if (longest) text = longest;
        }

        if (!text) continue;

        // Auteur
        let author: string | undefined;
        const usernameEl = card.querySelector('.username, [class*="username"], [class*="memberOverlay"]');
        if (usernameEl) {
          author = (usernameEl.textContent || '').trim() || undefined;
        }

        // Datum
        let date: string | undefined;
        const dateEl = card.querySelector('.ratingDate, [class*="ratingDate"]');
        if (dateEl) {
          date = dateEl.getAttribute('title') || (dateEl.textContent || '').trim() || undefined;
        }

        result.reviews.push({ author, rating, text, date });
      }

      return result;
    });

    return {
      averageRating: domData.averageRating,
      totalReviews: domData.totalReviews,
      reviews: domData.reviews.filter((r): r is Review => !!r.text).map((r) => ({
        author: r.author,
        rating: r.rating,
        text: r.text!,
        date: r.date,
      })),
      graphqlReviews,
    };
  }

  /**
   * Parseert GraphQL response data naar reviews.
   */
  private parseGraphqlResponse(json: any): Review[] {
    const reviews: Review[] = [];

    try {
      // Formaat 1: { data: { locations: [{ reviewList: { reviews: [...] } }] } }
      const locations = json?.data?.locations || json?.[0]?.data?.locations;
      if (locations) {
        for (const loc of locations) {
          const reviewList = loc?.reviewList?.reviews || loc?.reviews || [];
          for (const r of reviewList) {
            const review: Review = {
              text: r.text || r.title || '',
              author: r.username || r.userProfile?.displayName,
              rating: r.rating,
              date: r.publishedDate || r.createdDate,
            };
            if (review.text) reviews.push(review);
          }
        }
      }
    } catch {
      // Onverwacht formaat, negeren
    }

    return reviews;
  }

  /**
   * Fallback: extraheer reviews uit ruwe HTML met regex (bestaande methode).
   */
  private extractFromHtml(html: string): ParsedReviews {
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
   * Extraheert de eerste detail-pagina URL uit Tripadvisor zoekresultaten.
   * Zoekt naar links met /Restaurant_Review, /Hotel_Review, /Attraction_Review of /ShowUserReviews.
   */
  extractDetailUrl(html: string): string | undefined {
    const detailPattern = /href="((?:https:\/\/www\.tripadvisor\.com)?\/(?:Restaurant_Review|Hotel_Review|Attraction_Review|ShowUserReviews)[^"]+)"/;
    const match = html.match(detailPattern);
    if (!match) return undefined;

    const url = this.decodeHtmlEntities(match[1]);
    if (url.startsWith('/')) {
      return `https://www.tripadvisor.com${url}`;
    }
    return url;
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
