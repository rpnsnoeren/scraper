import { describe, it, expect, vi } from 'vitest';
import { TreatwellParser } from '../../review-parsers/treatwell';
import { ScraperService } from '../../scraper';

function createParser(overrides: Partial<ScraperService> = {}): TreatwellParser {
  const mockScraper = {
    fetchWithPlaywright: vi.fn(),
    fetchWithPlaywrightCustom: vi.fn(),
    ...overrides,
  } as unknown as ScraperService;
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

  describe('parse met __NEXT_DATA__', () => {
    it('extraheert reviews uit __NEXT_DATA__ JSON', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;
      const mockFetchCustom = (parser as any).scraper.fetchWithPlaywrightCustom;

      const searchHtml = '<a href="/salon/test-salon-1/">Test Salon</a>';
      mockFetch.mockResolvedValueOnce({ html: searchHtml, status: 200 });

      const nextData = JSON.stringify({
        props: {
          pageProps: {
            venue: {
              averageRating: 4.6,
              reviewCount: 120,
            },
            reviews: [
              { text: 'Geweldige kapper!', rating: 5, author: 'Lisa', date: '2024-03-15' },
              { text: 'Fijne behandeling', rating: 4, author: 'Sanne', createdAt: '2024-03-10' },
            ],
          },
        },
      });

      mockFetchCustom.mockResolvedValueOnce({ result: nextData });

      const result = await parser.parse('https://www.treatwell.nl/places/?q=test');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetchCustom).toHaveBeenCalledTimes(1);
      expect(result.averageRating).toBe(4.6);
      expect(result.totalReviews).toBe(120);
      expect(result.reviews).toHaveLength(2);
      expect(result.reviews[0].text).toBe('Geweldige kapper!');
      expect(result.reviews[0].author).toBe('Lisa');
      expect(result.reviews[0].rating).toBe(5);
      expect(result.reviews[1].date).toBe('2024-03-10');
    });

    it('extraheert reviews met consumer-structuur', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;
      const mockFetchCustom = (parser as any).scraper.fetchWithPlaywrightCustom;

      mockFetch.mockResolvedValueOnce({
        html: '<a href="/salon/test-salon/">Salon</a>',
        status: 200,
      });

      const nextData = JSON.stringify({
        props: {
          pageProps: {
            reviews: [
              {
                text: 'Top service',
                rating: 5,
                consumer: { displayName: 'Emma' },
                date: '2024-01-01',
              },
            ],
          },
        },
      });

      mockFetchCustom.mockResolvedValueOnce({ result: nextData });

      const result = await parser.parse('https://www.treatwell.nl/places/?q=test');
      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].author).toBe('Emma');
    });

    it('zoekt recursief naar diep geneste reviews', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;
      const mockFetchCustom = (parser as any).scraper.fetchWithPlaywrightCustom;

      mockFetch.mockResolvedValueOnce({
        html: '<a href="/salon/deep-salon/">Salon</a>',
        status: 200,
      });

      const nextData = JSON.stringify({
        props: {
          pageProps: {
            data: {
              salonPage: {
                venue: {
                  averageRating: 4.2,
                },
                reviewList: [
                  { text: 'Leuk!', score: 4, name: 'Jan', createdAt: '2024-02-01' },
                ],
              },
            },
          },
        },
      });

      mockFetchCustom.mockResolvedValueOnce({ result: nextData });

      const result = await parser.parse('https://www.treatwell.nl/places/?q=test');
      expect(result.averageRating).toBe(4.2);
      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].text).toBe('Leuk!');
      expect(result.reviews[0].author).toBe('Jan');
      expect(result.reviews[0].rating).toBe(4);
    });

    it('valt terug naar regex als __NEXT_DATA__ null is', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;
      const mockFetchCustom = (parser as any).scraper.fetchWithPlaywrightCustom;

      const searchHtml = '<a href="/salon/test-salon-1/">Test Salon</a>';
      const detailHtml = '<span class="rating-value">4.5</span><div class="review-card"><span class="review-text">Geweldig!</span></div>';

      mockFetch
        .mockResolvedValueOnce({ html: searchHtml, status: 200 })
        .mockResolvedValueOnce({ html: detailHtml, status: 200 });

      // __NEXT_DATA__ niet gevonden
      mockFetchCustom
        .mockResolvedValueOnce({ result: null })
        // DOM extractie vindt ook niets
        .mockResolvedValueOnce({ result: { reviews: [], averageRating: undefined, totalReviews: undefined } });

      const result = await parser.parse('https://www.treatwell.nl/places/?q=test');
      // Regex fallback
      expect(result.averageRating).toBe(4.5);
      expect(result.reviews).toHaveLength(1);
    });
  });

  describe('parse (geen salon-link)', () => {
    it('geeft lege reviews als er geen salon-link gevonden wordt', async () => {
      const parser = createParser();
      const mockFetch = (parser as any).scraper.fetchWithPlaywright;
      mockFetch.mockResolvedValueOnce({ html: '<div>Geen resultaten</div>', status: 200 });

      const result = await parser.parse('https://www.treatwell.nl/places/?q=test');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.reviews).toEqual([]);
    });
  });

  describe('__NEXT_DATA__ helpers', () => {
    it('mapNextDataReviews combineert title en text', () => {
      const parser = createParser() as any;
      const reviews = parser.mapNextDataReviews([
        { title: 'Geweldig', text: 'Fijne kapper', rating: 5, author: 'Test' },
      ]);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].text).toBe('Geweldig - Fijne kapper');
    });

    it('mapNextDataReviews handelt comment/body velden af', () => {
      const parser = createParser() as any;
      const reviews = parser.mapNextDataReviews([
        { comment: 'Via comment', rating: 4 },
        { body: 'Via body', score: 3 },
      ]);
      expect(reviews).toHaveLength(2);
      expect(reviews[0].text).toBe('Via comment');
      expect(reviews[0].rating).toBe(4);
      expect(reviews[1].text).toBe('Via body');
      expect(reviews[1].rating).toBe(3);
    });

    it('mapNextDataReviews slaat lege reviews over', () => {
      const parser = createParser() as any;
      const reviews = parser.mapNextDataReviews([
        { rating: 5 }, // geen tekst
        { text: 'Wel tekst', rating: 4 },
      ]);
      expect(reviews).toHaveLength(1);
    });

    it('findReviews zoekt recursief als bekende paden leeg zijn', () => {
      const parser = createParser() as any;
      const data = {
        props: {
          pageProps: {
            nested: {
              data: {
                items: [
                  { text: 'Review 1', rating: 5, author: 'A' },
                  { text: 'Review 2', rating: 4, author: 'B' },
                ],
              },
            },
          },
        },
      };
      const found = parser.findReviews(data);
      expect(found).toHaveLength(2);
    });

    it('extractNextDataRating vindt rating in venueData', () => {
      const parser = createParser() as any;
      const venueData = { averageRating: 4.3 };
      expect(parser.extractNextDataRating({}, venueData)).toBe(4.3);
    });

    it('extractNextDataRating vindt rating via recursieve zoeking', () => {
      const parser = createParser() as any;
      const data = { props: { pageProps: { venue: { averageRating: 4.7 } } } };
      expect(parser.extractNextDataRating(data, undefined)).toBe(4.7);
    });

    it('extractNextDataTotalReviews vindt count in venueData', () => {
      const parser = createParser() as any;
      const venueData = { reviewCount: 250 };
      expect(parser.extractNextDataTotalReviews({}, venueData)).toBe(250);
    });
  });

  describe('regex fallback (originele methodes)', () => {
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
});
