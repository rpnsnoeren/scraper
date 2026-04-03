import { describe, it, expect, vi } from 'vitest';
import { TrustpilotParser } from '../../review-parsers/trustpilot';
import { ScraperService } from '../../scraper';

function createParser(): TrustpilotParser {
  const mockScraper = {
    fetchWithPlaywright: vi.fn(),
  } as unknown as ScraperService;
  return new TrustpilotParser(mockScraper);
}

describe('TrustpilotParser', () => {
  describe('extractAverageRating', () => {
    it('extraheert rating uit data-rating-typography', () => {
      const parser = createParser() as any;
      const html = '<span data-rating-typography="true">4.3</span>';
      expect(parser.extractAverageRating(html)).toBe(4.3);
    });

    it('extraheert rating uit TrustScore', () => {
      const parser = createParser() as any;
      const html = '<p>TrustScore 4.7 uit 5</p>';
      expect(parser.extractAverageRating(html)).toBe(4.7);
    });

    it('extraheert rating met komma (NL formaat)', () => {
      const parser = createParser() as any;
      const html = '<span data-rating-typography="true">4,5</span>';
      expect(parser.extractAverageRating(html)).toBe(4.5);
    });

    it('geeft undefined bij ontbrekende rating', () => {
      const parser = createParser() as any;
      const html = '<div>Geen rating hier</div>';
      expect(parser.extractAverageRating(html)).toBeUndefined();
    });
  });

  describe('extractTotalReviews', () => {
    it('extraheert aantal uit NL formaat "1.234 beoordelingen"', () => {
      const parser = createParser() as any;
      const html = '<span>1.234 beoordelingen</span>';
      expect(parser.extractTotalReviews(html)).toBe(1234);
    });

    it('extraheert aantal uit EN formaat "1,234 reviews"', () => {
      const parser = createParser() as any;
      const html = '<span>1,234 reviews</span>';
      expect(parser.extractTotalReviews(html)).toBe(1234);
    });

    it('extraheert aantal zonder duizendtal-scheider', () => {
      const parser = createParser() as any;
      const html = '<span>456 reviews</span>';
      expect(parser.extractTotalReviews(html)).toBe(456);
    });

    it('geeft undefined bij ontbrekend aantal', () => {
      const parser = createParser() as any;
      const html = '<div>Geen aantal</div>';
      expect(parser.extractTotalReviews(html)).toBeUndefined();
    });
  });

  describe('parseCard', () => {
    it('parset een complete review card', () => {
      const parser = createParser() as any;
      const cardHtml = `
        <article data-service-review-card-paper>
          <div data-service-review-rating="4"></div>
          <p data-service-review-text-typography="true">Uitstekende service!</p>
          <span data-consumer-name-typography="true">Jan Jansen</span>
          <time datetime="2025-01-15">15 januari 2025</time>
        </article>
      `;
      const review = parser.parseCard(cardHtml);
      expect(review).toEqual({
        author: 'Jan Jansen',
        rating: 4,
        text: 'Uitstekende service!',
        date: '2025-01-15',
      });
    });

    it('parset card zonder auteur en datum', () => {
      const parser = createParser() as any;
      const cardHtml = `
        <article>
          <div data-service-review-rating="5"></div>
          <p data-service-review-text-typography="true">Top bedrijf</p>
        </article>
      `;
      const review = parser.parseCard(cardHtml);
      expect(review).toEqual({
        author: undefined,
        rating: 5,
        text: 'Top bedrijf',
        date: undefined,
      });
    });

    it('geeft null bij card zonder tekst', () => {
      const parser = createParser() as any;
      const cardHtml = `
        <article>
          <div data-service-review-rating="3"></div>
          <span data-consumer-name-typography="true">Piet</span>
        </article>
      `;
      const review = parser.parseCard(cardHtml);
      expect(review).toBeNull();
    });

    it('parset card met rating 1', () => {
      const parser = createParser() as any;
      const cardHtml = `
        <div data-service-review-rating="1"></div>
        <p data-service-review-text-typography="true">Slecht</p>
      `;
      const review = parser.parseCard(cardHtml);
      expect(review).not.toBeNull();
      expect(review!.rating).toBe(1);
      expect(review!.text).toBe('Slecht');
    });
  });
});
