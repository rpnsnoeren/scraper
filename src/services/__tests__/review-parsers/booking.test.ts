import { describe, it, expect, vi } from 'vitest';
import { BookingParser } from '../../review-parsers/booking';
import { ScraperService } from '../../scraper';

function createParser(): BookingParser {
  const mockScraper = {
    fetchWithPlaywright: vi.fn(),
    fetchWithPlaywrightCustom: vi.fn(),
  } as unknown as ScraperService;
  return new BookingParser(mockScraper);
}

describe('BookingParser', () => {
  describe('extractDetailUrl', () => {
    it('extraheert relatieve hotel-URL uit zoekresultaten', () => {
      const parser = createParser() as any;
      const html = '<a href="/hotel/nl/some-hotel.html">Hotel Amsterdam</a>';
      expect(parser.extractDetailUrl(html)).toBe('https://www.booking.com/hotel/nl/some-hotel.html');
    });

    it('extraheert absolute hotel-URL uit zoekresultaten', () => {
      const parser = createParser() as any;
      const html = '<a href="https://www.booking.com/hotel/nl/other-hotel.html">Hotel</a>';
      expect(parser.extractDetailUrl(html)).toBe('https://www.booking.com/hotel/nl/other-hotel.html');
    });

    it('geeft null bij geen hotel-links', () => {
      const parser = createParser() as any;
      expect(parser.extractDetailUrl('<div>Geen resultaten</div>')).toBeNull();
    });
  });

  describe('parse (twee-staps flow met Playwright scroll)', () => {
    it('gebruikt fetchWithPlaywrightCustom en extraheert reviews via page.evaluate', async () => {
      const parser = createParser();
      const mockFetchPw = (parser as any).scraper.fetchWithPlaywright;
      const mockFetchCustom = (parser as any).scraper.fetchWithPlaywrightCustom;

      const searchHtml = '<a href="/hotel/nl/test-hotel.html">Test Hotel</a>';
      mockFetchPw.mockResolvedValueOnce({ html: searchHtml, status: 200 });

      // Simuleer Playwright custom callback resultaat
      mockFetchCustom.mockResolvedValueOnce({
        result: {
          reviews: [
            { author: 'Hans', rating: 8.0, positive: 'Mooi hotel', negative: 'Luidruchtig', date: 'maart 2024' },
            { author: 'Maria', rating: 9.0, positive: 'Perfect verblijf', date: 'februari 2024' },
          ],
          averageRating: 8.0,
          totalReviews: 567,
        },
        html: '<div>detail page html</div>',
        status: 200,
      });

      const result = await parser.parse('https://www.booking.com/searchresults.html?ss=test');

      expect(mockFetchPw).toHaveBeenCalledTimes(1);
      expect(mockFetchCustom).toHaveBeenCalledTimes(1);
      expect(mockFetchCustom).toHaveBeenCalledWith(
        'https://www.booking.com/hotel/nl/test-hotel.html#tab-reviews',
        expect.any(Function),
        30000,
      );

      expect(result.averageRating).toBe(4.0); // 8.0 / 2
      expect(result.totalReviews).toBe(567);
      expect(result.reviews).toHaveLength(2);
      expect(result.reviews[0].author).toBe('Hans');
      expect(result.reviews[0].rating).toBe(4.0); // 8.0 / 2
      expect(result.reviews[0].text).toBe('Mooi hotel | Min: Luidruchtig');
      expect(result.reviews[1].author).toBe('Maria');
      expect(result.reviews[1].rating).toBe(4.5); // 9.0 / 2
      expect(result.reviews[1].text).toBe('Perfect verblijf');
    });

    it('valt terug op HTML parsing als Playwright geen reviews vindt', async () => {
      const parser = createParser();
      const mockFetchPw = (parser as any).scraper.fetchWithPlaywright;
      const mockFetchCustom = (parser as any).scraper.fetchWithPlaywrightCustom;

      const searchHtml = '<a href="/hotel/nl/test-hotel.html">Test Hotel</a>';
      mockFetchPw.mockResolvedValueOnce({ html: searchHtml, status: 200 });

      const detailHtml = 'Scored 8.0 <div data-testid="review-card"><span class="review-pos">Fijn</span></div>';
      mockFetchCustom.mockResolvedValueOnce({
        result: { reviews: [], averageRating: undefined, totalReviews: undefined },
        html: detailHtml,
        status: 200,
      });

      const result = await parser.parse('https://www.booking.com/searchresults.html?ss=test');

      expect(result.averageRating).toBe(4.0); // Scored 8.0 / 2 via HTML fallback
      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].text).toBe('Fijn');
    });

    it('geeft lege reviews als er geen hotel-link gevonden wordt', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;
      mockFetch.mockResolvedValueOnce({ html: '<div>Geen resultaten</div>', status: 200 });

      const result = await parser.parse('https://www.booking.com/searchresults.html?ss=test');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.reviews).toEqual([]);
    });

    it('filtert reviews zonder tekst uit Playwright resultaten', async () => {
      const parser = createParser();
      const mockFetchPw = (parser as any).scraper.fetchWithPlaywright;
      const mockFetchCustom = (parser as any).scraper.fetchWithPlaywrightCustom;

      mockFetchPw.mockResolvedValueOnce({
        html: '<a href="/hotel/nl/test.html">Hotel</a>',
        status: 200,
      });

      mockFetchCustom.mockResolvedValueOnce({
        result: {
          reviews: [
            { author: 'Hans', rating: 8.0, positive: 'Goed', date: 'jan 2024' },
            { author: 'Klaas', rating: 7.0 }, // Geen tekst -> wordt gefilterd
          ],
          averageRating: 7.5,
        },
        html: '',
        status: 200,
      });

      const result = await parser.parse('https://www.booking.com/searchresults.html?ss=test');
      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].author).toBe('Hans');
    });
  });

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

  describe('extractReviews (HTML fallback)', () => {
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
