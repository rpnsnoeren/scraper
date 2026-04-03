import { describe, it, expect, vi } from 'vitest';
import { GoogleReviewsParser } from '../../review-parsers/google';
import { ScraperService } from '../../scraper';

function createParser(): GoogleReviewsParser {
  const mockScraper = {
    fetchWithPlaywright: vi.fn(),
  } as unknown as ScraperService;
  return new GoogleReviewsParser(mockScraper);
}

describe('GoogleReviewsParser', () => {
  describe('extractAverageRating', () => {
    it('extraheert rating uit aria-label met sterren (NL)', () => {
      const parser = createParser() as any;
      const html = '<span aria-label="4,5 sterren"></span>';
      expect(parser.extractAverageRating(html)).toBe(4.5);
    });

    it('extraheert rating uit aria-label met stars (EN)', () => {
      const parser = createParser() as any;
      const html = '<span aria-label="4.2 stars"></span>';
      expect(parser.extractAverageRating(html)).toBe(4.2);
    });

    it('extraheert rating uit "X of 5" formaat', () => {
      const parser = createParser() as any;
      const html = '<div>4.5 of 5</div>';
      expect(parser.extractAverageRating(html)).toBe(4.5);
    });

    it('extraheert rating uit "X van 5" formaat (NL)', () => {
      const parser = createParser() as any;
      const html = '<div>4,3 van 5</div>';
      expect(parser.extractAverageRating(html)).toBe(4.3);
    });

    it('geeft undefined bij ontbrekende rating', () => {
      const parser = createParser() as any;
      const html = '<div>Geen rating</div>';
      expect(parser.extractAverageRating(html)).toBeUndefined();
    });
  });

  describe('extractTotalReviews', () => {
    it('extraheert aantal uit "1.234 reviews"', () => {
      const parser = createParser() as any;
      const html = '<span>1.234 reviews</span>';
      expect(parser.extractTotalReviews(html)).toBe(1234);
    });

    it('extraheert aantal uit "beoordelingen" (NL)', () => {
      const parser = createParser() as any;
      const html = '<span>567 beoordelingen</span>';
      expect(parser.extractTotalReviews(html)).toBe(567);
    });

    it('extraheert aantal uit EN formaat met komma', () => {
      const parser = createParser() as any;
      const html = '<span>2,345 reviews</span>';
      expect(parser.extractTotalReviews(html)).toBe(2345);
    });

    it('geeft undefined bij ontbrekend aantal', () => {
      const parser = createParser() as any;
      const html = '<div>Leeg</div>';
      expect(parser.extractTotalReviews(html)).toBeUndefined();
    });
  });

  describe('parseReviewBlock', () => {
    it('parset een compleet review blok', () => {
      const parser = createParser() as any;
      const blockHtml = `
        <div data-review-id="abc123">
          <span aria-label="5 sterren"></span>
          <span class="review-full-text">Geweldige ervaring, echt aanrader!</span>
          <img aria-label="Foto van Maria de Vries" />
          <span>2 weken geleden</span>
        </div>
      `;
      const review = parser.parseReviewBlock(blockHtml);
      expect(review).toEqual({
        author: 'Maria de Vries',
        rating: 5,
        text: 'Geweldige ervaring, echt aanrader!',
        date: '2 weken geleden',
      });
    });

    it('parset review met Engelse labels', () => {
      const parser = createParser() as any;
      const blockHtml = `
        <div data-review-id="def456">
          <span aria-label="4 stars"></span>
          <span class="review-full-text">Great place to visit</span>
          <img aria-label="Photo of John Smith" />
          <span>3 months ago</span>
        </div>
      `;
      const review = parser.parseReviewBlock(blockHtml);
      expect(review).toEqual({
        author: 'John Smith',
        rating: 4,
        text: 'Great place to visit',
        date: '3 months ago',
      });
    });

    it('parset review zonder auteur en datum', () => {
      const parser = createParser() as any;
      const blockHtml = `
        <div data-review-id="ghi789">
          <span aria-label="3 sterren"></span>
          <span class="review-full-text">Redelijk goed</span>
        </div>
      `;
      const review = parser.parseReviewBlock(blockHtml);
      expect(review).toEqual({
        author: undefined,
        rating: 3,
        text: 'Redelijk goed',
        date: undefined,
      });
    });

    it('geeft null bij blok zonder tekst', () => {
      const parser = createParser() as any;
      const blockHtml = `
        <div data-review-id="xyz">
          <span aria-label="4 sterren"></span>
          <img aria-label="Foto van Kees" />
        </div>
      `;
      const review = parser.parseReviewBlock(blockHtml);
      expect(review).toBeNull();
    });

    it('parset review met "1 dag geleden"', () => {
      const parser = createParser() as any;
      const blockHtml = `
        <div data-review-id="t1">
          <span aria-label="2 sterren"></span>
          <span class="review-full-text">Teleurstellend</span>
          <span>1 dag geleden</span>
        </div>
      `;
      const review = parser.parseReviewBlock(blockHtml);
      expect(review!.date).toBe('1 dag geleden');
    });
  });
});
