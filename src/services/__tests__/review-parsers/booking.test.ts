import { describe, it, expect, vi } from 'vitest';
import { BookingParser } from '../../review-parsers/booking';
import { ScraperService } from '../../scraper';

function createParser(): BookingParser {
  const mockScraper = { fetchWithPlaywright: vi.fn() } as unknown as ScraperService;
  return new BookingParser(mockScraper);
}

describe('BookingParser', () => {
  describe('extractAverageRating (10→5 conversie)', () => {
    it('converteert "Scored 8.5" naar 4.3 (8.5/2)', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('Scored 8.5')).toBe(4.3);
    });

    it('converteert data-testid review-score "9,0" naar 4.5', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<div data-testid="review-score">9,0</div>')).toBe(4.5);
    });

    it('converteert review-score-badge "8,5" naar 4.3', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<span class="review-score-badge">8,5</span>')).toBe(4.3);
    });

    it('converteert "Scored 10" naar 5.0', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('Scored 10')).toBe(5);
    });

    it('converteert "Scored 7.0" naar 3.5', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('Scored 7.0')).toBe(3.5);
    });

    it('geeft undefined bij geen match', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<div>niks</div>')).toBeUndefined();
    });
  });

  describe('extractTotalReviews', () => {
    it('extraheert "567 beoordelingen"', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('567 beoordelingen')).toBe(567);
    });

    it('extraheert "1.234 gastbeoordelingen"', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('1.234 gastbeoordelingen')).toBe(1234);
    });

    it('extraheert "456 reviews"', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('456 reviews')).toBe(456);
    });

    it('geeft undefined bij geen match', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('<div>geen info</div>')).toBeUndefined();
    });
  });

  describe('extractReviews', () => {
    it('parset review-cards met positieve en negatieve tekst', () => {
      const parser = createParser() as any;
      const html = `
        <div data-testid="review-card">
          <span class="reviewer-name">Hans</span>
          <span class="review-score">8.0</span>
          <span class="review-pos">Mooi hotel</span>
          <span class="review-neg">Luidruchtig</span>
          <span class="review-date">maart 2024</span>
        </div>
        <div data-testid="review-card">
          <span class="reviewer-name">Maria</span>
          <span class="review-score">9.0</span>
          <span class="review-pos">Perfect verblijf</span>
          <span class="review-date">februari 2024</span>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(2);

      // Eerste review: positief + negatief
      expect(reviews[0].author).toBe('Hans');
      expect(reviews[0].rating).toBe(4.0);
      expect(reviews[0].text).toBe('Mooi hotel | Min: Luidruchtig');
      expect(reviews[0].date).toBe('maart 2024');

      // Tweede review: alleen positief
      expect(reviews[1].author).toBe('Maria');
      expect(reviews[1].rating).toBe(4.5);
      expect(reviews[1].text).toBe('Perfect verblijf');
    });

    it('converteert card rating van 10-schaal naar 5-schaal', () => {
      const parser = createParser() as any;
      const html = `
        <div data-testid="review-card">
          <span class="review-score">7.0</span>
          <span class="review-pos">Goed</span>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews[0].rating).toBe(3.5);
    });

    it('parset review met alleen negatieve tekst', () => {
      const parser = createParser() as any;
      const html = `
        <div data-testid="review-card">
          <span class="review-neg">Vies</span>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].text).toBe('Min: Vies');
    });

    it('slaat kaart zonder positieve of negatieve tekst over', () => {
      const parser = createParser() as any;
      const html = `
        <div data-testid="review-card">
          <span class="reviewer-name">Klaas</span>
          <span class="review-score">8.0</span>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(0);
    });

    it('geeft lege array bij geen review-blokken', () => {
      const parser = createParser() as any;
      expect(parser.extractReviews('<div>Geen reviews</div>')).toEqual([]);
    });
  });
});
