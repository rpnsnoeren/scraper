import { describe, it, expect, vi } from 'vitest';
import { YelpParser } from '../../review-parsers/yelp';
import { ScraperService } from '../../scraper';

function createParser(): YelpParser {
  const mockScraper = {
    fetchWithPlaywright: vi.fn(),
  } as unknown as ScraperService;
  return new YelpParser(mockScraper);
}

describe('YelpParser', () => {
  describe('extractAverageRating', () => {
    it('haalt rating op uit aria-label="X star rating"', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<div aria-label="4.5 star rating"></div>')).toBe(4.5);
    });

    it('haalt geheel getal rating op', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<div aria-label="4 star rating"></div>')).toBe(4);
    });

    it('geeft undefined bij ontbrekende aria-label', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<div>Geen rating</div>')).toBeUndefined();
    });

    it('geeft undefined bij lege HTML', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('')).toBeUndefined();
    });
  });

  describe('extractTotalReviews', () => {
    it('haalt aantal op uit "reviews"', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('1,234 reviews')).toBe(1234);
    });

    it('haalt aantal op uit "beoordelingen"', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('567 beoordelingen')).toBe(567);
    });

    it('geeft undefined bij lege HTML', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('')).toBeUndefined();
    });

    it('haalt grote aantallen op met NL punt-scheider', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('2.456 reviews')).toBe(2456);
    });
  });

  describe('extractReviews', () => {
    it('extraheert reviews uit review__ class blokken', () => {
      const parser = createParser() as any;
      const html = `
        <div class="review__container">
          <div aria-label="5 star"></div>
          <div class="comment"><p>Fantastisch eten!</p></div>
          <div class="user-passport-info"><a href="/user/123">Maria</a></div>
          <span>03/15/2025</span>
        </div>
        <div class="review__container">
          <div aria-label="3 star"></div>
          <p lang="en">Average experience</p>
          <div class="user-passport-info"><a href="/user/456">Peter</a></div>
          <span>02/20/2025</span>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(2);
      expect(reviews[0]).toEqual({
        author: 'Maria',
        rating: 5,
        text: 'Fantastisch eten!',
        date: '03/15/2025',
      });
      expect(reviews[1]).toEqual({
        author: 'Peter',
        rating: 3,
        text: 'Average experience',
        date: '02/20/2025',
      });
    });

    it('extraheert tekst uit <p lang="..."> als fallback', () => {
      const parser = createParser() as any;
      const html = `
        <div class="review__item">
          <p lang="nl">Goede service en lekker eten</p>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].text).toBe('Goede service en lekker eten');
    });

    it('geeft lege array bij HTML zonder reviews', () => {
      const parser = createParser() as any;
      expect(parser.extractReviews('<div>Geen reviews</div>')).toEqual([]);
    });

    it('skipt blokken zonder tekst', () => {
      const parser = createParser() as any;
      const html = `
        <div class="review__item">
          <div aria-label="4 star"></div>
          <div class="user-passport-info"><a href="/user/789">Test</a></div>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(0);
    });

    it('verwijdert HTML tags uit comment tekst', () => {
      const parser = createParser() as any;
      const html = `
        <div class="review__block">
          <div class="comment"><p>Tekst met <b>HTML</b> tags</p></div>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].text).toBe('Tekst met HTML tags');
    });
  });
});
