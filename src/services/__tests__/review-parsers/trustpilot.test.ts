import { describe, it, expect, vi } from 'vitest';
import { TrustpilotParser } from '../../review-parsers/trustpilot';
import { ScraperService } from '../../scraper';

function createParser(overrides: Partial<ScraperService> = {}): TrustpilotParser {
  const mockScraper = {
    fetchWithPlaywright: vi.fn(),
    fetchWithPlaywrightCustom: vi.fn(),
    ...overrides,
  } as unknown as ScraperService;
  return new TrustpilotParser(mockScraper);
}

/** Helper: bouwt een minimaal __NEXT_DATA__ JSON object */
function buildNextData(opts: {
  trustScore?: number;
  numberOfReviews?: number;
  reviews?: Array<{
    text?: string;
    title?: string;
    rating?: number;
    consumer?: { displayName?: string };
    dates?: { publishedDate?: string };
  }>;
}) {
  return {
    props: {
      pageProps: {
        businessUnit: {
          trustScore: opts.trustScore,
          numberOfReviews: opts.numberOfReviews,
        },
        reviews: opts.reviews ?? [],
      },
    },
  };
}

describe('TrustpilotParser', () => {
  describe('__NEXT_DATA__ extractie', () => {
    it('extraheert rating, totaal en reviews uit __NEXT_DATA__', async () => {
      const nextData = buildNextData({
        trustScore: 4.5,
        numberOfReviews: 2, // Gelijk aan aantal reviews, geen paginering
        reviews: [
          {
            text: 'Geweldige ervaring',
            rating: 5,
            consumer: { displayName: 'Jan Jansen' },
            dates: { publishedDate: '2025-06-10' },
          },
          {
            text: 'Prima service',
            title: 'Goed',
            rating: 4,
            consumer: { displayName: 'Piet Pietersen' },
            dates: { publishedDate: '2025-06-09' },
          },
        ],
      });

      const parser = createParser({
        fetchWithPlaywrightCustom: vi.fn().mockResolvedValue({
          result: JSON.stringify(nextData),
          html: '<html></html>',
          status: 200,
        }),
      });

      const result = await parser.parse('https://www.trustpilot.com/review/example.com');

      expect(result.averageRating).toBe(4.5);
      expect(result.totalReviews).toBe(2);
      expect(result.reviews).toHaveLength(2);
      expect(result.reviews[0]).toEqual({
        author: 'Jan Jansen',
        rating: 5,
        text: 'Geweldige ervaring',
        date: '2025-06-10',
      });
      expect(result.reviews[1]).toEqual({
        author: 'Piet Pietersen',
        rating: 4,
        text: 'Goed - Prima service',
        date: '2025-06-09',
      });
    });

    it('valt terug op regex als __NEXT_DATA__ niet gevonden is', async () => {
      const htmlContent = `
        <span data-rating-typography="true">4.2</span>
        <span>500 reviews</span>
        <article data-service-review-card-paper>
          <div data-service-review-rating="3"></div>
          <p data-service-review-text-typography="true">Oké</p>
          <span data-consumer-name-typography="true">Klaas</span>
          <time datetime="2025-03-01">1 maart</time>
        </article>
      `;

      const parser = createParser({
        fetchWithPlaywrightCustom: vi.fn().mockResolvedValue({
          result: null,
          html: htmlContent,
          status: 200,
        }),
        fetchWithPlaywright: vi.fn().mockResolvedValue({
          html: htmlContent,
          status: 200,
        }),
      });

      const result = await parser.parse('https://www.trustpilot.com/review/example.com');

      expect(result.averageRating).toBe(4.2);
      expect(result.totalReviews).toBe(500);
      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].author).toBe('Klaas');
    });

    it('valt terug op regex bij ongeldige JSON', async () => {
      const htmlContent = '<span data-rating-typography="true">3.8</span><span>100 reviews</span>';

      const parser = createParser({
        fetchWithPlaywrightCustom: vi.fn().mockResolvedValue({
          result: 'niet-geldige-json{{{',
          html: htmlContent,
          status: 200,
        }),
        fetchWithPlaywright: vi.fn().mockResolvedValue({
          html: htmlContent,
          status: 200,
        }),
      });

      const result = await parser.parse('https://www.trustpilot.com/review/example.com');

      expect(result.averageRating).toBe(3.8);
      expect(result.totalReviews).toBe(100);
    });

    it('filtert reviews zonder tekst uit __NEXT_DATA__', async () => {
      const nextData = buildNextData({
        trustScore: 4.0,
        numberOfReviews: 1, // Gelijk aan verwacht resultaat, geen paginering
        reviews: [
          { text: 'Heeft tekst', rating: 4, consumer: { displayName: 'A' } },
          { rating: 3, consumer: { displayName: 'B' } }, // Geen tekst
        ],
      });

      const parser = createParser({
        fetchWithPlaywrightCustom: vi.fn().mockResolvedValue({
          result: JSON.stringify(nextData),
          html: '',
          status: 200,
        }),
      });

      const result = await parser.parse('https://www.trustpilot.com/review/example.com');

      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].text).toBe('Heeft tekst');
    });

    it('haalt extra paginas op bij meer reviews', async () => {
      const page1Data = buildNextData({
        trustScore: 4.3,
        numberOfReviews: 50,
        reviews: [
          { text: 'Review pagina 1', rating: 5, consumer: { displayName: 'A' }, dates: { publishedDate: '2025-01-01' } },
        ],
      });

      const page2Data = buildNextData({
        trustScore: 4.3,
        numberOfReviews: 50,
        reviews: [
          { text: 'Review pagina 2', rating: 4, consumer: { displayName: 'B' }, dates: { publishedDate: '2025-01-02' } },
        ],
      });

      const page3Data = buildNextData({
        trustScore: 4.3,
        numberOfReviews: 50,
        reviews: [
          { text: 'Review pagina 3', rating: 3, consumer: { displayName: 'C' }, dates: { publishedDate: '2025-01-03' } },
        ],
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ result: JSON.stringify(page1Data), html: '', status: 200 })
        .mockResolvedValueOnce({ result: JSON.stringify(page2Data), html: '', status: 200 })
        .mockResolvedValueOnce({ result: JSON.stringify(page3Data), html: '', status: 200 });

      const parser = createParser({
        fetchWithPlaywrightCustom: fetchMock,
      });

      const result = await parser.parse('https://www.trustpilot.com/review/example.com');

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.reviews).toHaveLength(3);
      expect(result.totalReviews).toBe(50);
    });

    it('haalt maximaal 3 paginas op', async () => {
      const makePageData = (pageNum: number) => buildNextData({
        trustScore: 4.0,
        numberOfReviews: 1000, // Veel meer dan 3 paginas
        reviews: [
          { text: `Review pagina ${pageNum}`, rating: 5, consumer: { displayName: `User ${pageNum}` } },
        ],
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ result: JSON.stringify(makePageData(1)), html: '', status: 200 })
        .mockResolvedValueOnce({ result: JSON.stringify(makePageData(2)), html: '', status: 200 })
        .mockResolvedValueOnce({ result: JSON.stringify(makePageData(3)), html: '', status: 200 });

      const parser = createParser({
        fetchWithPlaywrightCustom: fetchMock,
      });

      const result = await parser.parse('https://www.trustpilot.com/review/example.com');

      // Maximaal 3 paginas, niet meer
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.reviews).toHaveLength(3);
    });

    it('vindt businessUnit via diep geneste structuur', async () => {
      // Simuleer een alternatieve __NEXT_DATA__ structuur
      const nextData = {
        pageProps: {
          businessUnit: {
            trustScore: 4.8,
            numberOfReviews: 200,
          },
          reviews: [
            { text: 'Top!', rating: 5, consumer: { displayName: 'Test' } },
          ],
        },
      };

      const parser = createParser({
        fetchWithPlaywrightCustom: vi.fn().mockResolvedValue({
          result: JSON.stringify(nextData),
          html: '',
          status: 200,
        }),
      });

      const result = await parser.parse('https://www.trustpilot.com/review/example.com');

      expect(result.averageRating).toBe(4.8);
      expect(result.totalReviews).toBe(200);
    });
  });

  describe('extractAverageRating (regex fallback)', () => {
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

  describe('extractTotalReviews (regex fallback)', () => {
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

  describe('parseCard (regex fallback)', () => {
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
