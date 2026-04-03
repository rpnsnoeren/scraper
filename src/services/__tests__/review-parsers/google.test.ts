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
  describe('extractPlaceUrl', () => {
    it('extraheert absolute place URL uit href', () => {
      const parser = createParser() as any;
      const html = '<a href="https://www.google.com/maps/place/Treatwell/data=!1234">Treatwell</a>';
      expect(parser.extractPlaceUrl(html)).toBe('https://www.google.com/maps/place/Treatwell/data=!1234');
    });

    it('extraheert place URL uit data attributen of JS', () => {
      const parser = createParser() as any;
      const html = 'window.url = "https://www.google.nl/maps/place/Treatwell+Amsterdam/@52.37,4.89"';
      expect(parser.extractPlaceUrl(html)).toBe('https://www.google.nl/maps/place/Treatwell+Amsterdam/@52.37,4.89');
    });

    it('extraheert relatieve place URL en maakt deze absoluut', () => {
      const parser = createParser() as any;
      const html = '<a href="/maps/place/Treatwell/data=!5678">link</a>';
      expect(parser.extractPlaceUrl(html)).toBe('https://www.google.com/maps/place/Treatwell/data=!5678');
    });

    it('geeft undefined bij geen place URL', () => {
      const parser = createParser() as any;
      expect(parser.extractPlaceUrl('<div>Geen resultaten</div>')).toBeUndefined();
    });
  });

  describe('parse - zoek naar detail navigatie', () => {
    it('haalt detail-pagina op als place URL gevonden wordt', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;

      // Eerste call: zoekresultaten met place link
      mockFetch.mockResolvedValueOnce({
        html: '<a href="https://www.google.com/maps/place/Treatwell/data=!123">Treatwell</a>',
        status: 200,
      });
      // Tweede call: detail-pagina met reviews
      mockFetch.mockResolvedValueOnce({
        html: `
          <span aria-label="4,5 sterren"></span>
          <span>100 reviews</span>
          <div data-review-id="r1">
            <span aria-label="5 sterren"></span>
            <span class="review-full-text">Top!</span>
          </div>
        `,
        status: 200,
      });

      const result = await parser.parse('https://www.google.com/maps/search/Treatwell');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith('https://www.google.com/maps/place/Treatwell/data=!123', 20000);
      expect(result.averageRating).toBe(4.5);
      expect(result.reviews).toHaveLength(1);
    });

    it('gebruikt zoekresultaat-HTML als geen place URL gevonden wordt', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;

      // Enkel zoekpagina zonder place links maar met review data (direct redirect)
      mockFetch.mockResolvedValueOnce({
        html: `
          <span aria-label="4,0 sterren"></span>
          <span>50 reviews</span>
        `,
        status: 200,
      });

      const result = await parser.parse('https://www.google.com/maps/search/Treatwell');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.averageRating).toBe(4.0);
    });

    it('geeft leeg resultaat als er geen reviews zijn', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;

      mockFetch.mockResolvedValueOnce({ html: '<div>Geen resultaten</div>', status: 200 });

      const result = await parser.parse('https://www.google.com/maps/search/Onbekend');
      expect(result.reviews).toHaveLength(0);
      expect(result.averageRating).toBeUndefined();
      expect(result.totalReviews).toBeUndefined();
    });
  });

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
