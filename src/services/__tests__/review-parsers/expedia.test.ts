import { describe, it, expect, vi } from 'vitest';
import { ExpediaParser } from '../../review-parsers/expedia';
import { ScraperService } from '../../scraper';

function createParser(): ExpediaParser {
  const mockScraper = {
    fetchWithPlaywright: vi.fn(),
  } as unknown as ScraperService;
  return new ExpediaParser(mockScraper);
}

describe('ExpediaParser', () => {
  describe('extractAverageRating', () => {
    it('haalt rating op uit X/5 formaat', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('Score: 4.2/5 based on reviews')).toBe(4.2);
    });

    it('haalt rating op uit X out of 5 formaat', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('Rated 4.5 out of 5')).toBe(4.5);
    });

    it('converteert 10-schaal naar 5-schaal', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('Score: 8.4/10')).toBe(4.2);
    });

    it('converteert 10-schaal met komma', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('Score: 7,0/10')).toBe(3.5);
    });

    it('geeft undefined bij lege HTML', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('')).toBeUndefined();
    });

    it('geeft undefined bij HTML zonder rating', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<div>Geen rating hier</div>')).toBeUndefined();
    });

    it('prefereert /10 boven /5 als /10 eerder komt', () => {
      const parser = createParser() as any;
      // /10 wordt eerst gematcht
      expect(parser.extractAverageRating('8.0/10 en ook 4.0/5')).toBe(4.0);
    });
  });

  describe('extractTotalReviews', () => {
    it('haalt aantal op uit "verified reviews"', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('Based on 1,234 verified reviews')).toBe(1234);
    });

    it('haalt aantal op uit "beoordelingen"', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('523 beoordelingen')).toBe(523);
    });

    it('haalt aantal op uit "reviews"', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('2.456 reviews')).toBe(2456);
    });

    it('geeft undefined bij lege HTML', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('')).toBeUndefined();
    });
  });

  describe('extractReviews', () => {
    it('extraheert reviews uit itemprop="review" blokken', () => {
      const parser = createParser() as any;
      const html = `
        <div itemprop="review">
          <span itemprop="ratingValue" content="4.5"></span>
          <span itemprop="description">Geweldig hotel!</span>
          <span itemprop="author">Jan Jansen</span>
          <meta itemprop="datePublished" content="2025-12-01">
        </div>
        <div itemprop="review">
          <span itemprop="ratingValue" content="3.0"></span>
          <span itemprop="description">Prima verblijf</span>
          <span itemprop="author">Piet Pietersen</span>
          <meta itemprop="datePublished" content="2025-11-15">
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(2);
      expect(reviews[0]).toEqual({
        author: 'Jan Jansen',
        rating: 4.5,
        text: 'Geweldig hotel!',
        date: '2025-12-01',
      });
      expect(reviews[1]).toEqual({
        author: 'Piet Pietersen',
        rating: 3.0,
        text: 'Prima verblijf',
        date: '2025-11-15',
      });
    });

    it('extraheert reviews uit data-stid="review-card" als fallback', () => {
      const parser = createParser() as any;
      const html = `
        <div data-stid="review-card">
          <span itemprop="ratingValue" content="5.0"></span>
          <span itemprop="description">Perfect!</span>
          <span itemprop="author">Anna</span>
          <meta itemprop="datePublished" content="2025-10-01">
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].text).toBe('Perfect!');
      expect(reviews[0].rating).toBe(5.0);
    });

    it('converteert rating > 5 naar 5-schaal', () => {
      const parser = createParser() as any;
      const html = `
        <div itemprop="review">
          <span itemprop="ratingValue" content="8.0"></span>
          <span itemprop="description">Mooi hotel</span>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].rating).toBe(4.0);
    });

    it('geeft lege array bij HTML zonder reviews', () => {
      const parser = createParser() as any;
      expect(parser.extractReviews('<div>Geen reviews</div>')).toEqual([]);
    });

    it('skipt blokken zonder description', () => {
      const parser = createParser() as any;
      const html = `
        <div itemprop="review">
          <span itemprop="ratingValue" content="4.0"></span>
          <span itemprop="author">Test</span>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(0);
    });
  });
});
