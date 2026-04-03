import { describe, it, expect, vi } from 'vitest';
import { TripadvisorParser } from '../../review-parsers/tripadvisor';
import { ScraperService } from '../../scraper';

function createParser(): TripadvisorParser {
  const mockScraper = { fetchWithPlaywright: vi.fn() } as unknown as ScraperService;
  return new TripadvisorParser(mockScraper);
}

describe('TripadvisorParser', () => {
  describe('extractDetailUrl', () => {
    it('extraheert Restaurant_Review URL uit zoekresultaten', () => {
      const parser = createParser() as any;
      const html = '<a href="/Restaurant_Review-g188590-d12345-Reviews-Treatwell-Amsterdam.html">Treatwell</a>';
      expect(parser.extractDetailUrl(html)).toBe('https://www.tripadvisor.com/Restaurant_Review-g188590-d12345-Reviews-Treatwell-Amsterdam.html');
    });

    it('extraheert Hotel_Review URL', () => {
      const parser = createParser() as any;
      const html = '<a href="/Hotel_Review-g188590-d67890-Reviews-Hotel_Test.html">Hotel</a>';
      expect(parser.extractDetailUrl(html)).toBe('https://www.tripadvisor.com/Hotel_Review-g188590-d67890-Reviews-Hotel_Test.html');
    });

    it('extraheert Attraction_Review URL', () => {
      const parser = createParser() as any;
      const html = '<a href="/Attraction_Review-g188590-d11111-Reviews-Museum.html">Museum</a>';
      expect(parser.extractDetailUrl(html)).toBe('https://www.tripadvisor.com/Attraction_Review-g188590-d11111-Reviews-Museum.html');
    });

    it('behoudt absolute URL als die al compleet is', () => {
      const parser = createParser() as any;
      const html = '<a href="https://www.tripadvisor.com/Restaurant_Review-g188590-d12345.html">Link</a>';
      expect(parser.extractDetailUrl(html)).toBe('https://www.tripadvisor.com/Restaurant_Review-g188590-d12345.html');
    });

    it('geeft undefined bij geen detail URL', () => {
      const parser = createParser() as any;
      expect(parser.extractDetailUrl('<div>Geen resultaten</div>')).toBeUndefined();
    });
  });

  describe('parse - zoek naar detail navigatie', () => {
    it('haalt detail-pagina op als detail URL gevonden wordt', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;

      // Eerste call: zoekresultaten met detail link
      mockFetch.mockResolvedValueOnce({
        html: '<a href="/Restaurant_Review-g188590-d12345-Reviews-Treatwell.html">Treatwell</a>',
        status: 200,
      });
      // Tweede call: detail-pagina met reviews
      mockFetch.mockResolvedValueOnce({
        html: `
          <span data-rating="4.5"></span>
          <span>200 reviews</span>
          <div data-test-target="HR_CC_CARD">
            <span class="username">Jan</span>
            <span title="4 of 5 bubbles"></span>
            <span data-test-target="review-body">Goed eten!</span>
          </div>
        `,
        status: 200,
      });

      const result = await parser.parse('https://www.tripadvisor.com/Search?q=Treatwell');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.tripadvisor.com/Restaurant_Review-g188590-d12345-Reviews-Treatwell.html',
        30000
      );
      expect(result.averageRating).toBe(4.5);
      expect(result.reviews).toHaveLength(1);
    });

    it('gebruikt zoekresultaat-HTML als geen detail URL gevonden wordt', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;

      mockFetch.mockResolvedValueOnce({
        html: '<span data-rating="3.5"></span><span>10 reviews</span>',
        status: 200,
      });

      const result = await parser.parse('https://www.tripadvisor.com/Search?q=Test');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.averageRating).toBe(3.5);
    });

    it('geeft leeg resultaat als er geen reviews zijn', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;

      mockFetch.mockResolvedValueOnce({ html: '<div>Geen resultaten</div>', status: 200 });

      const result = await parser.parse('https://www.tripadvisor.com/Search?q=Onbekend');
      expect(result.reviews).toHaveLength(0);
      expect(result.averageRating).toBeUndefined();
    });
  });

  describe('extractAverageRating', () => {
    it('extraheert rating uit data-rating attribuut', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('data-rating="4.5"')).toBe(4.5);
    });

    it('extraheert rating uit "X of 5 bubbles"', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('4.5 of 5 bubbles')).toBe(4.5);
    });

    it('extraheert rating met komma notatie', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('data-rating="4,5"')).toBe(4.5);
    });

    it('geeft undefined bij geen match', () => {
      const parser = createParser() as any;
      expect(parser.extractAverageRating('<div>geen rating hier</div>')).toBeUndefined();
    });
  });

  describe('extractTotalReviews', () => {
    it('extraheert aantal uit "2.345 reviews"', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('2.345 reviews')).toBe(2345);
    });

    it('extraheert aantal uit "123 beoordelingen"', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('123 beoordelingen')).toBe(123);
    });

    it('geeft undefined bij geen match', () => {
      const parser = createParser() as any;
      expect(parser.extractTotalReviews('<div>geen info</div>')).toBeUndefined();
    });
  });

  describe('extractReviews', () => {
    it('parset review-cards met data-test-target', () => {
      const parser = createParser() as any;
      const html = `
        <div data-test-target="HR_CC_CARD">
          <span class="username">Jan</span>
          <span title="4 of 5 bubbles"></span>
          <span data-test-target="review-body">Geweldig restaurant!</span>
          <span class="ratingDate" title="March 2024">March 2024</span>
        </div>
        <div data-test-target="HR_CC_CARD">
          <span class="username">Piet</span>
          <span title="3 of 5 bubbles"></span>
          <span data-test-target="review-body">Matig eten</span>
          <span class="ratingDate" title="February 2024">February 2024</span>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(2);
      expect(reviews[0].author).toBe('Jan');
      expect(reviews[0].rating).toBe(4);
      expect(reviews[0].text).toBe('Geweldig restaurant!');
      expect(reviews[0].date).toBe('March 2024');
      expect(reviews[1].author).toBe('Piet');
      expect(reviews[1].rating).toBe(3);
    });

    it('parset review met bubble_45 class (4.5 rating)', () => {
      const parser = createParser() as any;
      const html = `
        <div data-test-target="HR_CC_CARD">
          <span class="bubble_45"></span>
          <span data-test-target="review-body">Goed!</span>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].rating).toBe(4.5);
    });

    it('parset review met partial_entry class', () => {
      const parser = createParser() as any;
      const html = `
        <div data-test-target="HR_CC_CARD">
          <span class="partial_entry">Leuk bezoek</span>
        </div>
      `;
      const reviews = parser.extractReviews(html);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].text).toBe('Leuk bezoek');
    });

    it('slaat kaart zonder tekst over', () => {
      const parser = createParser() as any;
      const html = `
        <div data-test-target="HR_CC_CARD">
          <span class="username">Klaas</span>
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
