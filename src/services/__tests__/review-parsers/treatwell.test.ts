import { describe, it, expect, vi } from 'vitest';
import { TreatwellParser } from '../../review-parsers/treatwell';
import { ScraperService } from '../../scraper';

function createParser(): TreatwellParser {
  const mockScraper = { fetchWithPlaywright: vi.fn() } as unknown as ScraperService;
  return new TreatwellParser(mockScraper);
}

describe('TreatwellParser', () => {
  describe('extractDetailUrl', () => {
    it('extraheert relatieve salon-URL uit zoekresultaten', () => {
      const parser = createParser() as any;
      const html = '<a href="/salon/kapper-amsterdam-123/">Salon Amsterdam</a>';
      expect(parser.extractDetailUrl(html)).toBe('https://www.treatwell.nl/salon/kapper-amsterdam-123/');
    });

    it('extraheert absolute salon-URL uit zoekresultaten', () => {
      const parser = createParser() as any;
      const html = '<a href="https://www.treatwell.nl/salon/kapper-amsterdam-456/">Salon</a>';
      expect(parser.extractDetailUrl(html)).toBe('https://www.treatwell.nl/salon/kapper-amsterdam-456/');
    });

    it('geeft null bij geen salon-links', () => {
      const parser = createParser() as any;
      expect(parser.extractDetailUrl('<div>Geen resultaten</div>')).toBeNull();
    });
  });

  describe('parse (twee-staps flow)', () => {
    it('haalt zoekresultaten op, vindt detail-URL en parset reviews', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;
      const searchHtml = '<a href="/salon/test-salon-1/">Test Salon</a>';
      const detailHtml = '<span class="rating-value">4.5</span><div class="review-card"><span class="review-text">Geweldig!</span></div>';
      mockFetch
        .mockResolvedValueOnce({ html: searchHtml, status: 200 })
        .mockResolvedValueOnce({ html: detailHtml, status: 200 });

      const result = await parser.parse('https://www.treatwell.nl/places/?q=test');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith('https://www.treatwell.nl/salon/test-salon-1/', 30000);
      expect(result.averageRating).toBe(4.5);
      expect(result.reviews).toHaveLength(1);
    });

    it('geeft lege reviews als er geen salon-link gevonden wordt', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;
      mockFetch.mockResolvedValueOnce({ html: '<div>Geen resultaten</div>', status: 200 });

      const result = await parser.parse('https://www.treatwell.nl/places/?q=test');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.reviews).toEqual([]);
    });
  });

  describe('extractAverageRating', () => {
    it('extraheert rating uit rating-value class', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<span class="rating-value">4.3</span>')).toBe(4.3);
    });

    it('extraheert rating uit data-rating attribuut', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<div data-rating="4.7"></div>')).toBe(4.7);
    });

    it('handelt komma-notatie af', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<span class="rating-value">4,8</span>')).toBe(4.8);
    });

    it('geeft undefined bij geen match', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<div>niks</div>')).toBeUndefined();
    });

    it('weigert waarde boven 5', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<span class="rating-value">8.5</span>')).toBeUndefined();
    });
  });

  describe('extractTotalReviews', () => {
    it('extraheert aantal uit "89 beoordelingen"', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('89 beoordelingen')).toBe(89);
    });

    it('extraheert aantal met duizendtallen "1.234 beoordelingen"', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('1.234 beoordelingen')).toBe(1234);
    });

    it('geeft undefined bij geen match', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('<div>geen info</div>')).toBeUndefined();
    });
  });

  describe('extractReviews', () => {
    it('parset review-card blokken', () => {
      const parser = createParser() as any;
      const html = `
        <div class="review-card">
          <span class="review-author">Lisa</span>
          <span data-rating="4.5"></span>
          <span class="review-text">Fantastische behandeling!</span>
          <span class="review-date">15 maart 2024</span>
        </div>
        <div class="review-card">
          <span class="review-author">Sanne</span>
          <span data-rating="3.0"></span>
          <span class="review-body">Was oké</span>
          <span class="review-date">10 maart 2024</span>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(2);
      expect(reviews[0].author).toBe('Lisa');
      expect(reviews[0].rating).toBe(4.5);
      expect(reviews[0].text).toBe('Fantastische behandeling!');
      expect(reviews[0].date).toBe('15 maart 2024');
      expect(reviews[1].text).toBe('Was oké');
    });

    it('parset review-item blokken', () => {
      const parser = createParser() as any;
      const html = `
        <div class="review-item">
          <span class="review-name">Emma</span>
          <span class="review-content">Top!</span>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].author).toBe('Emma');
      expect(reviews[0].text).toBe('Top!');
    });

    it('slaat kaart zonder tekst over', () => {
      const parser = createParser() as any;
      const html = `
        <div class="review-card">
          <span class="review-author">Anoniem</span>
          <span data-rating="5"></span>
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
