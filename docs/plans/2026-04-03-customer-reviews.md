# Customer Reviews Scraper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a `POST /api/customer-reviews` endpoint that discovers and scrapes reviews from multiple platforms for a given business name/domain.

**Architecture:** Google Search discovers which review platforms have listings for the business. Per gevonden platform scrapet een dedicated parser de reviews (rating, tekst, datum). De orchestrator coördineert discovery + parsing + caching, met graceful handling als een platform faalt.

**Tech Stack:** Fastify, Zod, Playwright (ScraperService), CacheService, Vitest

---

## Task 1: Zod Types & Schemas

**Files:**
- Create: `src/types/customer-reviews.ts`

**Step 1: Write the type file**

```typescript
import { z } from 'zod';

export const CustomerReviewsRequestSchema = z.object({
  businessName: z.string().min(1, 'Bedrijfsnaam is verplicht'),
  domain: z.string().optional(),
});

export type CustomerReviewsRequest = z.infer<typeof CustomerReviewsRequestSchema>;

export const ReviewSchema = z.object({
  author: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  text: z.string(),
  date: z.string().optional(),
});

export type Review = z.infer<typeof ReviewSchema>;

export const PlatformReviewsSchema = z.object({
  platform: z.string(),
  url: z.string(),
  averageRating: z.number().min(0).max(5).optional(),
  totalReviews: z.number().optional(),
  reviews: z.array(ReviewSchema),
});

export type PlatformReviews = z.infer<typeof PlatformReviewsSchema>;

export const CustomerReviewsResponseSchema = z.object({
  businessName: z.string(),
  domain: z.string().optional(),
  platforms: z.array(PlatformReviewsSchema),
  cached: z.boolean(),
  scrapedAt: z.string(),
});

export type CustomerReviewsResponse = z.infer<typeof CustomerReviewsResponseSchema>;
```

**Step 2: Commit**

```bash
git add src/types/customer-reviews.ts
git commit -m "feat(customer-reviews): Zod schemas voor request/response types"
```

---

## Task 2: Review Discovery Service

**Files:**
- Create: `src/services/review-discovery.ts`
- Test: `src/services/__tests__/review-discovery.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ReviewDiscoveryService } from '../review-discovery';

describe('ReviewDiscoveryService', () => {
  it('should build correct Google search URL', () => {
    const service = new ReviewDiscoveryService(null as any);
    const url = service.buildSearchUrl('Kapper Amsterdam');
    expect(url).toContain('google.com/search');
    expect(url).toContain('Kapper+Amsterdam');
    expect(url).toContain('reviews');
  });

  it('should extract platform URLs from Google search HTML', () => {
    const service = new ReviewDiscoveryService(null as any);
    const html = `
      <a href="https://www.trustpilot.com/review/kapper.nl">Trustpilot</a>
      <a href="https://www.tripadvisor.com/Restaurant_Review-kapper">TripAdvisor</a>
      <a href="https://www.google.com/maps/place/Kapper">Google Maps</a>
      <a href="https://www.treatwell.nl/salon/kapper-amsterdam">Treatwell</a>
      <a href="https://www.booking.com/hotel/nl/kapper.html">Booking</a>
      <a href="https://www.expedia.com/Amsterdam-Hotels-Kapper">Expedia</a>
      <a href="https://www.yelp.com/biz/kapper-amsterdam">Yelp</a>
      <a href="https://www.randomsite.com/page">Random</a>
    `;
    const platforms = service.extractPlatformUrls(html);
    expect(platforms.length).toBe(7);
    expect(platforms.map(p => p.platform)).toContain('trustpilot');
    expect(platforms.map(p => p.platform)).toContain('tripadvisor');
    expect(platforms.map(p => p.platform)).toContain('google');
    expect(platforms.map(p => p.platform)).toContain('treatwell');
    expect(platforms.map(p => p.platform)).toContain('booking');
    expect(platforms.map(p => p.platform)).toContain('expedia');
    expect(platforms.map(p => p.platform)).toContain('yelp');
    expect(platforms.map(p => p.platform)).not.toContain('randomsite');
  });

  it('should also search with domain if provided', () => {
    const service = new ReviewDiscoveryService(null as any);
    const url = service.buildSearchUrl('Kapper Amsterdam', 'kapper.nl');
    expect(url).toContain('kapper.nl');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/review-discovery.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
import { ScraperService } from './scraper';

export interface DiscoveredPlatform {
  platform: string;
  url: string;
}

const PLATFORM_PATTERNS: { platform: string; pattern: RegExp }[] = [
  { platform: 'trustpilot', pattern: /trustpilot\.com\/review\// },
  { platform: 'tripadvisor', pattern: /tripadvisor\.(com|nl|de|co\.uk)\/(Restaurant_Review|Hotel_Review|Attraction_Review|ShowUserReviews)/ },
  { platform: 'google', pattern: /google\.(com|nl|de|co\.uk)\/maps\/place\// },
  { platform: 'treatwell', pattern: /treatwell\.(nl|com|de|co\.uk)\/salon\// },
  { platform: 'booking', pattern: /booking\.com\/hotel\// },
  { platform: 'expedia', pattern: /expedia\.(com|nl|de|co\.uk)\// },
  { platform: 'yelp', pattern: /yelp\.(com|nl|de|co\.uk)\/(biz|business)\// },
];

export class ReviewDiscoveryService {
  constructor(private scraper: ScraperService) {}

  buildSearchUrl(businessName: string, domain?: string): string {
    const query = domain
      ? `${businessName} ${domain} reviews`
      : `${businessName} reviews`;
    return `https://www.google.com/search?q=${encodeURIComponent(query).replace(/%20/g, '+')}&num=20&hl=nl`;
  }

  extractPlatformUrls(html: string): DiscoveredPlatform[] {
    const found: DiscoveredPlatform[] = [];
    const seenPlatforms = new Set<string>();

    // Extract all href values from the HTML
    const hrefRegex = /href="(https?:\/\/[^"]+)"/g;
    let match;
    while ((match = hrefRegex.exec(html)) !== null) {
      const url = match[1];
      for (const { platform, pattern } of PLATFORM_PATTERNS) {
        if (!seenPlatforms.has(platform) && pattern.test(url)) {
          seenPlatforms.add(platform);
          found.push({ platform, url: this.cleanGoogleUrl(url) });
          break;
        }
      }
    }

    return found;
  }

  private cleanGoogleUrl(url: string): string {
    // Google wraps links in redirects — extract the actual URL
    try {
      const parsed = new URL(url);
      const q = parsed.searchParams.get('q') || parsed.searchParams.get('url');
      if (q && q.startsWith('http')) return q;
    } catch {}
    return url;
  }

  async discover(businessName: string, domain?: string): Promise<DiscoveredPlatform[]> {
    const searchUrl = this.buildSearchUrl(businessName, domain);
    const { html } = await this.scraper.fetchWithPlaywright(searchUrl, 30000);
    const platforms = this.extractPlatformUrls(html);

    // Als er een domain is, zoek ook direct op bekende platform-URLs
    if (domain) {
      const directUrls = this.buildDirectUrls(domain, businessName);
      for (const candidate of directUrls) {
        if (!platforms.find(p => p.platform === candidate.platform)) {
          platforms.push(candidate);
        }
      }
    }

    return platforms;
  }

  private buildDirectUrls(domain: string, businessName: string): DiscoveredPlatform[] {
    const slug = domain.replace(/\.(com|nl|de|co\.uk|be|org|net)$/i, '').replace(/\./g, '-');
    return [
      { platform: 'trustpilot', url: `https://www.trustpilot.com/review/${domain}` },
      { platform: 'treatwell', url: `https://www.treatwell.nl/salon/${slug}/` },
    ];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/review-discovery.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/review-discovery.ts src/services/__tests__/review-discovery.test.ts
git commit -m "feat(customer-reviews): review discovery service met Google Search"
```

---

## Task 3: Review Parser Interface & Base Class

**Files:**
- Create: `src/services/review-parsers/base.ts`

**Step 1: Write the base parser**

```typescript
import { Review } from '../../types/customer-reviews';
import { ScraperService } from '../scraper';

export interface ParsedReviews {
  averageRating?: number;
  totalReviews?: number;
  reviews: Review[];
}

export abstract class ReviewParser {
  constructor(protected scraper: ScraperService) {}

  abstract parse(url: string): Promise<ParsedReviews>;

  protected selectRandom(reviews: Review[], max: number = 10): Review[] {
    if (reviews.length <= max) return reviews;
    const shuffled = [...reviews].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, max);
  }

  protected parseRating(text: string): number | undefined {
    // "4.5/5", "4,5", "4.5 out of 5", "4.5 stars"
    const match = text.match(/(\d+[.,]\d+)\s*(?:\/\s*5|out of|stars|sterren)?/i);
    if (match) return parseFloat(match[1].replace(',', '.'));
    return undefined;
  }

  protected parseReviewCount(text: string): number | undefined {
    // "1.234 reviews", "1,234 beoordelingen", "(456)"
    const match = text.match(/([\d.,]+)\s*(?:reviews?|beoordelingen|ratings?|recensies)/i)
      || text.match(/\(([\d.,]+)\)/);
    if (match) return parseInt(match[1].replace(/[.,]/g, ''), 10);
    return undefined;
  }
}
```

**Step 2: Commit**

```bash
git add src/services/review-parsers/base.ts
git commit -m "feat(customer-reviews): base review parser met shared utilities"
```

---

## Task 4: Platform Parsers (PARALLEL — via subagents)

> **Uitvoering:** Start 6 subagents parallel, elk bouwt één parser + test.

Alle parsers volgen hetzelfde patroon:
1. Fetch de pagina via ScraperService (Playwright)
2. Parse de HTML voor gemiddelde rating, totaal reviews, en individuele reviews
3. Selecteer max 10 random reviews
4. Return een `ParsedReviews` object

### Task 4a: Trustpilot Parser

**Files:**
- Create: `src/services/review-parsers/trustpilot.ts`
- Test: `src/services/__tests__/review-parsers/trustpilot.test.ts`

**Implementation:**

```typescript
import { ReviewParser, ParsedReviews } from './base';
import { Review } from '../../types/customer-reviews';

export class TrustpilotParser extends ReviewParser {
  async parse(url: string): Promise<ParsedReviews> {
    const { html } = await this.scraper.fetchWithPlaywright(url, 30000);

    const averageRating = this.extractAverageRating(html);
    const totalReviews = this.extractTotalReviews(html);
    const reviews = this.extractReviews(html);

    return {
      averageRating,
      totalReviews,
      reviews: this.selectRandom(reviews),
    };
  }

  private extractAverageRating(html: string): number | undefined {
    // Trustpilot: <span data-rating-typography="true">4.5</span>
    // or: <p class="typography_heading-m..." data-service-review-rating-label>
    const match = html.match(/data-rating-typography[^>]*>(\d+[.,]\d+)</);
    if (match) return parseFloat(match[1].replace(',', '.'));
    // Fallback: TrustScore
    const fallback = html.match(/TrustScore\s+(\d+[.,]\d+)/i);
    if (fallback) return parseFloat(fallback[1].replace(',', '.'));
    return undefined;
  }

  private extractTotalReviews(html: string): number | undefined {
    // "Gebaseerd op 1.234 beoordelingen" or "Based on 1,234 reviews"
    const match = html.match(/([\d.,]+)\s*(?:beoordelingen|reviews|total)/i);
    if (match) return parseInt(match[1].replace(/[.,]/g, ''), 10);
    return undefined;
  }

  private extractReviews(html: string): Review[] {
    const reviews: Review[] = [];
    // Trustpilot review cards: <article> with data-service-review-card-paper
    const cardRegex = /data-service-review-card-paper[^>]*>([\s\S]*?)(?=data-service-review-card-paper|<\/section)/g;
    let match;
    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[1];
      const review = this.parseCard(card);
      if (review) reviews.push(review);
    }
    return reviews;
  }

  private parseCard(card: string): Review | null {
    // Rating from star count: data-service-review-rating="4"
    const ratingMatch = card.match(/data-service-review-rating="(\d)"/);
    // Review text: <p data-service-review-text-typography
    const textMatch = card.match(/data-service-review-text-typography[^>]*>([\s\S]*?)<\/p>/);
    // Author: <span data-consumer-name-typography
    const authorMatch = card.match(/data-consumer-name-typography[^>]*>([^<]+)/);
    // Date: <time datetime="2025-01-15T..."
    const dateMatch = card.match(/datetime="(\d{4}-\d{2}-\d{2})/);

    const text = textMatch ? textMatch[1].replace(/<[^>]+>/g, '').trim() : null;
    if (!text) return null;

    return {
      author: authorMatch ? authorMatch[1].trim() : undefined,
      rating: ratingMatch ? parseInt(ratingMatch[1]) : undefined,
      text,
      date: dateMatch ? dateMatch[1] : undefined,
    };
  }
}
```

**Test:**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { TrustpilotParser } from '../../review-parsers/trustpilot';

describe('TrustpilotParser', () => {
  it('should extract average rating from HTML', () => {
    const parser = new TrustpilotParser(null as any);
    const html = '<span data-rating-typography="true">4.3</span>';
    expect((parser as any).extractAverageRating(html)).toBe(4.3);
  });

  it('should extract total reviews from HTML', () => {
    const parser = new TrustpilotParser(null as any);
    const html = '<p>Gebaseerd op 1.234 beoordelingen</p>';
    expect((parser as any).extractTotalReviews(html)).toBe(1234);
  });

  it('should parse a review card', () => {
    const parser = new TrustpilotParser(null as any);
    const card = `
      <div data-service-review-rating="5"></div>
      <p data-service-review-text-typography="true">Geweldige service!</p>
      <span data-consumer-name-typography="true">Jan Jansen</span>
      <time datetime="2026-03-15T10:00:00Z"></time>
    `;
    const review = (parser as any).parseCard(card);
    expect(review).toEqual({
      author: 'Jan Jansen',
      rating: 5,
      text: 'Geweldige service!',
      date: '2026-03-15',
    });
  });

  it('should return null for card without text', () => {
    const parser = new TrustpilotParser(null as any);
    const card = '<div data-service-review-rating="3"></div>';
    expect((parser as any).parseCard(card)).toBeNull();
  });
});
```

### Task 4b: Google Reviews Parser

**Files:**
- Create: `src/services/review-parsers/google.ts`
- Test: `src/services/__tests__/review-parsers/google.test.ts`

**Implementation:**

```typescript
import { ReviewParser, ParsedReviews } from './base';
import { Review } from '../../types/customer-reviews';

export class GoogleReviewsParser extends ReviewParser {
  async parse(url: string): Promise<ParsedReviews> {
    // Google Maps place pages require Playwright — heavy JS rendering
    const { html } = await this.scraper.fetchWithPlaywright(url, 45000);

    const averageRating = this.extractAverageRating(html);
    const totalReviews = this.extractTotalReviews(html);
    const reviews = this.extractReviews(html);

    return {
      averageRating,
      totalReviews,
      reviews: this.selectRandom(reviews),
    };
  }

  private extractAverageRating(html: string): number | undefined {
    // Google Maps: <span class="...">4,5</span> near "sterren" or aria-label="4.5 stars"
    const ariaMatch = html.match(/aria-label="(\d+[.,]\d+)\s*(?:stars?|sterren)"/i);
    if (ariaMatch) return parseFloat(ariaMatch[1].replace(',', '.'));
    // Fallback: "4,5 van 5 sterren"
    const textMatch = html.match(/(\d+[.,]\d+)\s*(?:van|of|out of)\s*5/i);
    if (textMatch) return parseFloat(textMatch[1].replace(',', '.'));
    return undefined;
  }

  private extractTotalReviews(html: string): number | undefined {
    // "(1.234 reviews)" or "(1.234)"
    const match = html.match(/([\d.,]+)\s*(?:reviews?|beoordelingen|recensies)/i);
    if (match) return parseInt(match[1].replace(/[.,]/g, ''), 10);
    return undefined;
  }

  private extractReviews(html: string): Review[] {
    const reviews: Review[] = [];
    // Google reviews are in divs with data-review-id or class containing "review"
    // Each review has: author name, star rating (aria-label), text, relative date
    const reviewBlockRegex = /data-review-id="[^"]*"([\s\S]*?)(?=data-review-id|class="[^"]*review-dialog)/g;
    let match;
    while ((match = reviewBlockRegex.exec(html)) !== null) {
      const block = match[1];
      const review = this.parseReviewBlock(block);
      if (review) reviews.push(review);
    }
    return reviews;
  }

  private parseReviewBlock(block: string): Review | null {
    // Stars: aria-label="5 sterren" or "Rated 4.0 out of 5"
    const ratingMatch = block.match(/aria-label="(\d+)\s*(?:sterren|stars?)"/i)
      || block.match(/Rated\s+(\d+(?:\.\d+)?)/i);
    // Text: typically in a <span> with class containing "review-full-text" or long text
    const textMatch = block.match(/class="[^"]*review-full-text[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      || block.match(/<span[^>]*>([\s\S]{50,}?)<\/span>/);
    // Author
    const authorMatch = block.match(/aria-label="[^"]*foto van ([^"]+)"/i)
      || block.match(/class="[^"]*d4r55[^"]*"[^>]*>([^<]+)/);
    // Date: "2 weken geleden", "een maand geleden"
    const dateMatch = block.match(/(\d+\s+(?:dag|dagen|week|weken|maand|maanden|jaar)\s+geleden)/i)
      || block.match(/(a\s+(?:day|week|month|year)\s+ago|\d+\s+(?:days?|weeks?|months?|years?)\s+ago)/i);

    const text = textMatch ? textMatch[1].replace(/<[^>]+>/g, '').trim() : null;
    if (!text || text.length < 10) return null;

    return {
      author: authorMatch ? authorMatch[1].trim() : undefined,
      rating: ratingMatch ? parseInt(ratingMatch[1]) : undefined,
      text,
      date: dateMatch ? dateMatch[1].trim() : undefined,
    };
  }
}
```

**Test:**

```typescript
import { describe, it, expect } from 'vitest';
import { GoogleReviewsParser } from '../../review-parsers/google';

describe('GoogleReviewsParser', () => {
  it('should extract average rating from aria-label', () => {
    const parser = new GoogleReviewsParser(null as any);
    const html = '<span aria-label="4,5 sterren">4,5</span>';
    expect((parser as any).extractAverageRating(html)).toBe(4.5);
  });

  it('should extract total reviews', () => {
    const parser = new GoogleReviewsParser(null as any);
    const html = '<span>1.234 reviews</span>';
    expect((parser as any).extractTotalReviews(html)).toBe(1234);
  });
});
```

### Task 4c: Tripadvisor Parser

**Files:**
- Create: `src/services/review-parsers/tripadvisor.ts`
- Test: `src/services/__tests__/review-parsers/tripadvisor.test.ts`

**Implementation:**

```typescript
import { ReviewParser, ParsedReviews } from './base';
import { Review } from '../../types/customer-reviews';

export class TripadvisorParser extends ReviewParser {
  async parse(url: string): Promise<ParsedReviews> {
    const { html } = await this.scraper.fetchWithPlaywright(url, 30000);

    return {
      averageRating: this.extractAverageRating(html),
      totalReviews: this.extractTotalReviews(html),
      reviews: this.selectRandom(this.extractReviews(html)),
    };
  }

  private extractAverageRating(html: string): number | undefined {
    // TripAdvisor: class="biGQs _P fiohW uuBRH" or svg title="4.5 of 5 bubbles"
    const match = html.match(/(\d+[.,]\d+)\s*(?:of|van)\s*5\s*(?:bubbles|bellen)/i);
    if (match) return parseFloat(match[1].replace(',', '.'));
    // Fallback: data-rating="4.5"
    const dataMatch = html.match(/data-rating="(\d+\.?\d*)"/);
    if (dataMatch) return parseFloat(dataMatch[1]);
    return undefined;
  }

  private extractTotalReviews(html: string): number | undefined {
    const match = html.match(/([\d.,]+)\s*(?:reviews?|beoordelingen|recensies)/i);
    if (match) return parseInt(match[1].replace(/[.,]/g, ''), 10);
    return undefined;
  }

  private extractReviews(html: string): Review[] {
    const reviews: Review[] = [];
    // TripAdvisor review cards: data-test-target="HR_CC_CARD" or review-container
    const cardRegex = /data-test-target="HR_CC_CARD"([\s\S]*?)(?=data-test-target="HR_CC_CARD"|<\/section|$)/g;
    let match;
    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[1];
      const review = this.parseCard(card);
      if (review) reviews.push(review);
    }

    // Fallback: look for review text blocks
    if (reviews.length === 0) {
      const fallbackRegex = /class="[^"]*review-container[^"]*"([\s\S]*?)(?=class="[^"]*review-container|$)/g;
      while ((match = fallbackRegex.exec(html)) !== null) {
        const card = match[1];
        const review = this.parseCard(card);
        if (review) reviews.push(review);
      }
    }

    return reviews;
  }

  private parseCard(card: string): Review | null {
    // Rating: title="4 of 5 bubbles" or "4.0 van 5 bellen"
    const ratingMatch = card.match(/title="(\d+(?:\.\d+)?)\s*(?:of|van)\s*5/i)
      || card.match(/ui_bubble_rating\s+bubble_(\d)/);
    // Text
    const textMatch = card.match(/data-test-target="review-body"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/i)
      || card.match(/class="[^"]*partial_entry[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/i);
    // Author
    const authorMatch = card.match(/class="[^"]*username[^"]*"[^>]*>([^<]+)/i);
    // Date
    const dateMatch = card.match(/class="[^"]*ratingDate[^"]*"[^>]*title="([^"]+)"/i)
      || card.match(/(\w+\s+\d{4})/);

    const text = textMatch ? textMatch[1].replace(/<[^>]+>/g, '').trim() : null;
    if (!text || text.length < 10) return null;

    return {
      author: authorMatch ? authorMatch[1].trim() : undefined,
      rating: ratingMatch ? parseInt(ratingMatch[1]) : undefined,
      text,
      date: dateMatch ? dateMatch[1].trim() : undefined,
    };
  }
}
```

**Test:**

```typescript
import { describe, it, expect } from 'vitest';
import { TripadvisorParser } from '../../review-parsers/tripadvisor';

describe('TripadvisorParser', () => {
  it('should extract average rating from bubble format', () => {
    const parser = new TripadvisorParser(null as any);
    const html = '<svg title="4.5 of 5 bubbles"></svg>';
    expect((parser as any).extractAverageRating(html)).toBe(4.5);
  });

  it('should extract total reviews', () => {
    const parser = new TripadvisorParser(null as any);
    const html = '<span>2.345 reviews</span>';
    expect((parser as any).extractTotalReviews(html)).toBe(2345);
  });

  it('should parse review card', () => {
    const parser = new TripadvisorParser(null as any);
    const card = `
      <div title="4 of 5 bubbles"></div>
      <span data-test-target="review-body">Heerlijk gegeten, aanrader!</span>
      <span class="username">Pietje</span>
      <span class="ratingDate" title="maart 2026"></span>
    `;
    const review = (parser as any).parseCard(card);
    expect(review).toEqual({
      author: 'Pietje',
      rating: 4,
      text: 'Heerlijk gegeten, aanrader!',
      date: 'maart 2026',
    });
  });
});
```

### Task 4d: Treatwell Parser

**Files:**
- Create: `src/services/review-parsers/treatwell.ts`
- Test: `src/services/__tests__/review-parsers/treatwell.test.ts`

**Implementation:**

```typescript
import { ReviewParser, ParsedReviews } from './base';
import { Review } from '../../types/customer-reviews';

export class TreatwellParser extends ReviewParser {
  async parse(url: string): Promise<ParsedReviews> {
    const { html } = await this.scraper.fetchWithPlaywright(url, 30000);

    return {
      averageRating: this.extractAverageRating(html),
      totalReviews: this.extractTotalReviews(html),
      reviews: this.selectRandom(this.extractReviews(html)),
    };
  }

  private extractAverageRating(html: string): number | undefined {
    // Treatwell: <span class="rating-value">4,7</span> or data-rating="4.7"
    const match = html.match(/class="[^"]*rating-value[^"]*"[^>]*>(\d+[.,]\d+)/i)
      || html.match(/data-rating="(\d+\.?\d*)"/);
    if (match) return parseFloat(match[1].replace(',', '.'));
    return this.parseRating(html);
  }

  private extractTotalReviews(html: string): number | undefined {
    const match = html.match(/([\d.,]+)\s*(?:reviews?|beoordelingen|recensies)/i);
    if (match) return parseInt(match[1].replace(/[.,]/g, ''), 10);
    return undefined;
  }

  private extractReviews(html: string): Review[] {
    const reviews: Review[] = [];
    // Treatwell reviews in review-card or review-item divs
    const cardRegex = /class="[^"]*review[-_](?:card|item)[^"]*"([\s\S]*?)(?=class="[^"]*review[-_](?:card|item)|<\/section|$)/g;
    let match;
    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[1];
      const textMatch = card.match(/class="[^"]*review[-_](?:text|body|content)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i);
      const authorMatch = card.match(/class="[^"]*review[-_](?:author|name)[^"]*"[^>]*>([^<]+)/i);
      const ratingMatch = card.match(/data-rating="(\d+\.?\d*)"/i)
        || card.match(/(\d+[.,]\d+)\s*\/\s*5/);
      const dateMatch = card.match(/class="[^"]*review[-_]date[^"]*"[^>]*>([^<]+)/i);

      const text = textMatch ? textMatch[1].replace(/<[^>]+>/g, '').trim() : null;
      if (!text || text.length < 10) continue;

      reviews.push({
        author: authorMatch ? authorMatch[1].trim() : undefined,
        rating: ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : undefined,
        text,
        date: dateMatch ? dateMatch[1].trim() : undefined,
      });
    }
    return reviews;
  }
}
```

**Test:**

```typescript
import { describe, it, expect } from 'vitest';
import { TreatwellParser } from '../../review-parsers/treatwell';

describe('TreatwellParser', () => {
  it('should extract average rating', () => {
    const parser = new TreatwellParser(null as any);
    const html = '<span class="rating-value">4,7</span>';
    expect((parser as any).extractAverageRating(html)).toBe(4.7);
  });

  it('should extract total reviews', () => {
    const parser = new TreatwellParser(null as any);
    const html = '<span>89 beoordelingen</span>';
    expect((parser as any).extractTotalReviews(html)).toBe(89);
  });
});
```

### Task 4e: Booking.com Parser

**Files:**
- Create: `src/services/review-parsers/booking.ts`
- Test: `src/services/__tests__/review-parsers/booking.test.ts`

**Implementation:**

```typescript
import { ReviewParser, ParsedReviews } from './base';
import { Review } from '../../types/customer-reviews';

export class BookingParser extends ReviewParser {
  async parse(url: string): Promise<ParsedReviews> {
    const { html } = await this.scraper.fetchWithPlaywright(url, 30000);

    return {
      averageRating: this.extractAverageRating(html),
      totalReviews: this.extractTotalReviews(html),
      reviews: this.selectRandom(this.extractReviews(html)),
    };
  }

  private extractAverageRating(html: string): number | undefined {
    // Booking.com: "Scored 8.5" or class="review-score-badge">8,5</div>
    // Booking uses 0-10 scale, convert to 0-5
    const match = html.match(/(?:Scored|score[^>]*>)\s*(\d+[.,]\d+)/i)
      || html.match(/review-score-badge[^>]*>(\d+[.,]\d+)/i)
      || html.match(/data-testid="review-score"[^>]*>(\d+[.,]\d+)/i);
    if (match) {
      const score = parseFloat(match[1].replace(',', '.'));
      return Math.round((score / 2) * 10) / 10; // Convert 10-scale to 5-scale
    }
    return undefined;
  }

  private extractTotalReviews(html: string): number | undefined {
    const match = html.match(/([\d.,]+)\s*(?:reviews?|beoordelingen|gastbeoordelingen)/i);
    if (match) return parseInt(match[1].replace(/[.,]/g, ''), 10);
    return undefined;
  }

  private extractReviews(html: string): Review[] {
    const reviews: Review[] = [];
    // Booking review blocks
    const cardRegex = /data-testid="review-card"([\s\S]*?)(?=data-testid="review-card"|$)/g;
    let match;
    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[1];

      // Positive + negative text
      const positiveMatch = card.match(/class="[^"]*review[-_]pos[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i);
      const negativeMatch = card.match(/class="[^"]*review[-_]neg[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i);
      const scoreMatch = card.match(/class="[^"]*review[-_]score[^"]*"[^>]*>(\d+[.,]\d+)/i);
      const authorMatch = card.match(/class="[^"]*reviewer[-_]name[^"]*"[^>]*>([^<]+)/i);
      const dateMatch = card.match(/class="[^"]*review[-_]date[^"]*"[^>]*>([^<]+)/i);

      const parts = [];
      if (positiveMatch) parts.push(positiveMatch[1].replace(/<[^>]+>/g, '').trim());
      if (negativeMatch) parts.push('Min: ' + negativeMatch[1].replace(/<[^>]+>/g, '').trim());
      const text = parts.join(' | ');
      if (!text || text.length < 10) continue;

      const score = scoreMatch ? parseFloat(scoreMatch[1].replace(',', '.')) : undefined;

      reviews.push({
        author: authorMatch ? authorMatch[1].trim() : undefined,
        rating: score ? Math.round((score / 2) * 10) / 10 : undefined,
        text,
        date: dateMatch ? dateMatch[1].trim() : undefined,
      });
    }
    return reviews;
  }
}
```

**Test:**

```typescript
import { describe, it, expect } from 'vitest';
import { BookingParser } from '../../review-parsers/booking';

describe('BookingParser', () => {
  it('should convert 10-scale to 5-scale', () => {
    const parser = new BookingParser(null as any);
    const html = '<div class="review-score-badge">8,4</div>';
    expect((parser as any).extractAverageRating(html)).toBe(4.2);
  });

  it('should extract total reviews', () => {
    const parser = new BookingParser(null as any);
    const html = '<span>567 beoordelingen</span>';
    expect((parser as any).extractTotalReviews(html)).toBe(567);
  });
});
```

### Task 4f: Expedia Parser

**Files:**
- Create: `src/services/review-parsers/expedia.ts`
- Test: `src/services/__tests__/review-parsers/expedia.test.ts`

**Implementation:**

```typescript
import { ReviewParser, ParsedReviews } from './base';
import { Review } from '../../types/customer-reviews';

export class ExpediaParser extends ReviewParser {
  async parse(url: string): Promise<ParsedReviews> {
    const { html } = await this.scraper.fetchWithPlaywright(url, 30000);

    return {
      averageRating: this.extractAverageRating(html),
      totalReviews: this.extractTotalReviews(html),
      reviews: this.selectRandom(this.extractReviews(html)),
    };
  }

  private extractAverageRating(html: string): number | undefined {
    // Expedia: "4.2/5" or "4.2 out of 5"
    const match = html.match(/(\d+[.,]\d+)\s*(?:\/\s*5|out of 5|van 5)/i);
    if (match) return parseFloat(match[1].replace(',', '.'));
    // Expedia also uses 10-scale: "8.4/10"
    const tenScale = html.match(/(\d+[.,]\d+)\s*\/\s*10/i);
    if (tenScale) return Math.round((parseFloat(tenScale[1].replace(',', '.')) / 2) * 10) / 10;
    return undefined;
  }

  private extractTotalReviews(html: string): number | undefined {
    const match = html.match(/([\d.,]+)\s*(?:verified\s+)?(?:reviews?|beoordelingen|ratings?)/i);
    if (match) return parseInt(match[1].replace(/[.,]/g, ''), 10);
    return undefined;
  }

  private extractReviews(html: string): Review[] {
    const reviews: Review[] = [];
    // Expedia review cards: itemprop="review" or data-stid="review-card"
    const cardRegex = /(?:itemprop="review"|data-stid="review-card")([\s\S]*?)(?=itemprop="review"|data-stid="review-card"|$)/g;
    let match;
    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[1];
      const textMatch = card.match(/itemprop="description"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i)
        || card.match(/class="[^"]*review[-_](?:text|body|content)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i);
      const ratingMatch = card.match(/itemprop="ratingValue"[^>]*content="(\d+\.?\d*)"/i)
        || card.match(/(\d+[.,]\d+)\s*\/\s*(?:5|10)/);
      const authorMatch = card.match(/itemprop="author"[^>]*>([^<]+)/i);
      const dateMatch = card.match(/itemprop="datePublished"[^>]*content="([^"]+)"/i);

      const text = textMatch ? textMatch[1].replace(/<[^>]+>/g, '').trim() : null;
      if (!text || text.length < 10) continue;

      let rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : undefined;
      if (rating && rating > 5) rating = Math.round((rating / 2) * 10) / 10;

      reviews.push({
        author: authorMatch ? authorMatch[1].trim() : undefined,
        rating,
        text,
        date: dateMatch ? dateMatch[1].trim() : undefined,
      });
    }
    return reviews;
  }
}
```

**Test:**

```typescript
import { describe, it, expect } from 'vitest';
import { ExpediaParser } from '../../review-parsers/expedia';

describe('ExpediaParser', () => {
  it('should extract rating from 5-scale', () => {
    const parser = new ExpediaParser(null as any);
    const html = '<span>4.2/5</span>';
    expect((parser as any).extractAverageRating(html)).toBe(4.2);
  });

  it('should convert 10-scale to 5-scale', () => {
    const parser = new ExpediaParser(null as any);
    const html = '<span>8.4/10</span>';
    expect((parser as any).extractAverageRating(html)).toBe(4.2);
  });
});
```

### Task 4g: Yelp Parser

**Files:**
- Create: `src/services/review-parsers/yelp.ts`
- Test: `src/services/__tests__/review-parsers/yelp.test.ts`

**Implementation:**

```typescript
import { ReviewParser, ParsedReviews } from './base';
import { Review } from '../../types/customer-reviews';

export class YelpParser extends ReviewParser {
  async parse(url: string): Promise<ParsedReviews> {
    const { html } = await this.scraper.fetchWithPlaywright(url, 30000);

    return {
      averageRating: this.extractAverageRating(html),
      totalReviews: this.extractTotalReviews(html),
      reviews: this.selectRandom(this.extractReviews(html)),
    };
  }

  private extractAverageRating(html: string): number | undefined {
    // Yelp: aria-label="4.5 star rating" or "4 star rating"
    const match = html.match(/aria-label="(\d+\.?\d*)\s*star\s*rating"/i);
    if (match) return parseFloat(match[1]);
    return undefined;
  }

  private extractTotalReviews(html: string): number | undefined {
    const match = html.match(/([\d.,]+)\s*(?:reviews?|beoordelingen)/i);
    if (match) return parseInt(match[1].replace(/[.,]/g, ''), 10);
    return undefined;
  }

  private extractReviews(html: string): Review[] {
    const reviews: Review[] = [];
    // Yelp review cards
    const cardRegex = /class="[^"]*review__[^"]*"([\s\S]*?)(?=class="[^"]*review__|$)/g;
    let match;
    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[1];
      const textMatch = card.match(/class="[^"]*comment[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i)
        || card.match(/<p[^>]*lang="[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
      const ratingMatch = card.match(/aria-label="(\d+)\s*star/i);
      const authorMatch = card.match(/class="[^"]*user-passport[^"]*"[\s\S]*?<a[^>]*>([^<]+)/i);
      const dateMatch = card.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);

      const text = textMatch ? textMatch[1].replace(/<[^>]+>/g, '').trim() : null;
      if (!text || text.length < 10) continue;

      reviews.push({
        author: authorMatch ? authorMatch[1].trim() : undefined,
        rating: ratingMatch ? parseInt(ratingMatch[1]) : undefined,
        text,
        date: dateMatch ? dateMatch[1] : undefined,
      });
    }
    return reviews;
  }
}
```

**Test:**

```typescript
import { describe, it, expect } from 'vitest';
import { YelpParser } from '../../review-parsers/yelp';

describe('YelpParser', () => {
  it('should extract rating from aria-label', () => {
    const parser = new YelpParser(null as any);
    const html = '<div aria-label="4.5 star rating"></div>';
    expect((parser as any).extractAverageRating(html)).toBe(4.5);
  });
});
```

### Task 4 — Commit na alle parsers

```bash
git add src/services/review-parsers/ src/services/__tests__/review-parsers/
git commit -m "feat(customer-reviews): platform parsers voor Trustpilot, Google, Tripadvisor, Treatwell, Booking, Expedia en Yelp"
```

---

## Task 5: Parser Registry

**Files:**
- Create: `src/services/review-parsers/index.ts`

**Step 1: Write the registry**

```typescript
import { ScraperService } from '../scraper';
import { ReviewParser } from './base';
import { TrustpilotParser } from './trustpilot';
import { GoogleReviewsParser } from './google';
import { TripadvisorParser } from './tripadvisor';
import { TreatwellParser } from './treatwell';
import { BookingParser } from './booking';
import { ExpediaParser } from './expedia';
import { YelpParser } from './yelp';

const PARSER_MAP: Record<string, new (scraper: ScraperService) => ReviewParser> = {
  trustpilot: TrustpilotParser,
  google: GoogleReviewsParser,
  tripadvisor: TripadvisorParser,
  treatwell: TreatwellParser,
  booking: BookingParser,
  expedia: ExpediaParser,
  yelp: YelpParser,
};

export function getParser(platform: string, scraper: ScraperService): ReviewParser | null {
  const ParserClass = PARSER_MAP[platform];
  if (!ParserClass) return null;
  return new ParserClass(scraper);
}

export { ReviewParser, ParsedReviews } from './base';
```

**Step 2: Commit**

```bash
git add src/services/review-parsers/index.ts
git commit -m "feat(customer-reviews): parser registry voor platform routing"
```

---

## Task 6: Customer Reviews Orchestrator

**Files:**
- Create: `src/services/customer-reviews-orchestrator.ts`
- Test: `src/services/__tests__/customer-reviews-orchestrator.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerReviewsOrchestrator } from '../customer-reviews-orchestrator';
import { CacheService } from '../cache';

describe('CustomerReviewsOrchestrator', () => {
  let orchestrator: CustomerReviewsOrchestrator;
  let mockCache: CacheService;
  let mockScraper: any;

  beforeEach(() => {
    mockCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    } as any;
    mockScraper = {
      fetchWithPlaywright: vi.fn().mockResolvedValue({ html: '<html></html>', status: 200 }),
      fetch: vi.fn().mockResolvedValue({ html: '<html></html>', usedPlaywright: false, status: 200 }),
    };
  });

  it('should return cached result if available', async () => {
    const cachedResult = {
      businessName: 'Test',
      platforms: [],
      cached: false,
      scrapedAt: '2026-04-01T00:00:00Z',
    };
    (mockCache.get as any).mockResolvedValue(cachedResult);

    orchestrator = new CustomerReviewsOrchestrator(mockCache, mockScraper);
    const result = await orchestrator.scrape('Test');

    expect(result.cached).toBe(true);
    expect(mockScraper.fetchWithPlaywright).not.toHaveBeenCalled();
  });

  it('should return empty platforms when discovery finds nothing', async () => {
    orchestrator = new CustomerReviewsOrchestrator(mockCache, mockScraper);
    const result = await orchestrator.scrape('Nonexistent Business 12345');

    expect(result.platforms).toEqual([]);
    expect(result.cached).toBe(false);
    expect(result.businessName).toBe('Nonexistent Business 12345');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/customer-reviews-orchestrator.test.ts`
Expected: FAIL

**Step 3: Write the orchestrator**

```typescript
import { CacheService } from './cache';
import { ScraperService } from './scraper';
import { ReviewDiscoveryService } from './review-discovery';
import { getParser } from './review-parsers';
import { CustomerReviewsResponse, PlatformReviews } from '../types/customer-reviews';

const MAX_CONCURRENT_PARSERS = 3;
const PARSER_TIMEOUT = 45000;

export class CustomerReviewsOrchestrator {
  private discovery: ReviewDiscoveryService;

  constructor(
    private cache: CacheService,
    private scraper: ScraperService,
  ) {
    this.discovery = new ReviewDiscoveryService(scraper);
  }

  async scrape(businessName: string, domain?: string): Promise<CustomerReviewsResponse> {
    const cacheKey = `reviews:${businessName.toLowerCase()}:${domain?.toLowerCase() || ''}`;

    // 1. Check cache
    const cached = await this.cache.get<CustomerReviewsResponse>(cacheKey);
    if (cached) return { ...cached, cached: true };

    // 2. Discover platforms
    const discovered = await this.discovery.discover(businessName, domain);

    // 3. Parse reviews per platform (with concurrency limit)
    const platforms: PlatformReviews[] = [];
    const chunks = this.chunk(discovered, MAX_CONCURRENT_PARSERS);

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async ({ platform, url }) => {
          const parser = getParser(platform, this.scraper);
          if (!parser) return null;

          try {
            const result = await Promise.race([
              parser.parse(url),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Parser timeout')), PARSER_TIMEOUT)
              ),
            ]);

            return {
              platform,
              url,
              averageRating: result.averageRating,
              totalReviews: result.totalReviews,
              reviews: result.reviews,
            } as PlatformReviews;
          } catch (error) {
            // Graceful handling — platform niet beschikbaar
            return null;
          }
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          platforms.push(result.value);
        }
      }
    }

    // 4. Build response
    const response: CustomerReviewsResponse = {
      businessName,
      domain,
      platforms,
      cached: false,
      scrapedAt: new Date().toISOString(),
    };

    // 5. Cache result
    await this.cache.set(cacheKey, response);

    return response;
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/customer-reviews-orchestrator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/customer-reviews-orchestrator.ts src/services/__tests__/customer-reviews-orchestrator.test.ts
git commit -m "feat(customer-reviews): orchestrator met discovery, parsing en caching"
```

---

## Task 7: API Route

**Files:**
- Create: `src/routes/customer-reviews.ts`

**Step 1: Write the route**

```typescript
import { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { CustomerReviewsRequestSchema } from '../types/customer-reviews';
import { CustomerReviewsOrchestrator } from '../services/customer-reviews-orchestrator';

export async function customerReviewsRoutes(
  fastify: FastifyInstance,
  orchestrator: CustomerReviewsOrchestrator,
) {
  fastify.post('/api/customer-reviews', async (request, reply) => {
    try {
      const body = CustomerReviewsRequestSchema.parse(request.body);
      const result = await orchestrator.scrape(body.businessName, body.domain);
      return result;
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400).send({ error: 'Invalid request', details: error.issues });
        return;
      }
      fastify.log.error(error);
      reply.code(500).send({ error: 'Customer reviews scrape failed' });
    }
  });
}
```

**Step 2: Commit**

```bash
git add src/routes/customer-reviews.ts
git commit -m "feat(customer-reviews): POST /api/customer-reviews route"
```

---

## Task 8: Register in index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Add imports and registration**

Add import at top:
```typescript
import { customerReviewsRoutes } from './routes/customer-reviews';
import { CustomerReviewsOrchestrator } from './services/customer-reviews-orchestrator';
```

Add instantiation (after other orchestrators):
```typescript
const customerReviewsOrchestrator = new CustomerReviewsOrchestrator(cache, scraper);
```

Add route registration (after other routes):
```typescript
await customerReviewsRoutes(fastify, customerReviewsOrchestrator);
```

**Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat(customer-reviews): endpoint registratie in index.ts"
```

---

## Task 9: Frontend Tab & Panel

**Files:**
- Modify: `public/index.html`

**Step 1: Add to scrapers registry**

In the `scrapers` object, add:
```javascript
customerreviews: { endpoint: '/api/customer-reviews', name: 'Reviews', enabled: true },
```

**Step 2: Add tab button**

In `.scraper-tabs` div, add:
```html
<button class="scraper-tab" data-scraper="customerreviews" onclick="selectScraper('customerreviews')">
  <span class="icon">⭐</span> Reviews
</button>
```

**Step 3: Add panel**

Add a new panel div:
```html
<div id="customerreviews-panel" class="scraper-panel" style="display: none;">
  <div class="form-group">
    <label for="reviews-business">Bedrijfsnaam *</label>
    <input type="text" id="reviews-business" placeholder="bijv. Kapper Amsterdam" required>
  </div>
  <div class="form-group">
    <label for="reviews-domain">Domein (optioneel)</label>
    <input type="text" id="reviews-domain" placeholder="bijv. kapper.nl">
  </div>
  <button class="btn-primary" onclick="scrapeReviews()">Reviews ophalen</button>
  <div id="reviews-curl" class="curl-preview" style="display: none;"></div>
</div>
```

**Step 4: Add JS functions**

```javascript
async function scrapeReviews() {
  const businessName = document.getElementById('reviews-business').value;
  const domain = document.getElementById('reviews-domain').value;
  if (!businessName) { alert('Bedrijfsnaam is verplicht'); return; }

  const body = { businessName };
  if (domain) body.domain = domain;

  // Show curl
  const curlDiv = document.getElementById('reviews-curl');
  curlDiv.style.display = 'block';
  curlDiv.textContent = `curl -X POST ${window.location.origin}/api/customer-reviews \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '${JSON.stringify(body)}'`;

  await executeScrape('/api/customer-reviews', body);
}
```

**Step 5: Add result renderer**

In the `renderResults` function (or equivalent switch/if block), add handling for `customerreviews`:

```javascript
function renderReviewsResults(data) {
  if (!data.platforms || data.platforms.length === 0) {
    return '<p class="no-results">Geen reviews gevonden voor dit bedrijf.</p>';
  }

  let html = `<div class="reviews-summary">
    <h3>${data.businessName}</h3>
    <p>${data.platforms.length} platform(s) gevonden</p>
    ${data.cached ? '<span class="badge cached">Cached</span>' : ''}
  </div>`;

  for (const platform of data.platforms) {
    html += `<div class="platform-card">
      <div class="platform-header">
        <h4>${platform.platform}</h4>
        ${platform.averageRating ? `<span class="rating">${platform.averageRating}/5</span>` : ''}
        ${platform.totalReviews ? `<span class="review-count">${platform.totalReviews} reviews</span>` : ''}
      </div>
      <a href="${platform.url}" target="_blank" class="platform-url">${platform.url}</a>
      <div class="reviews-list">`;

    for (const review of platform.reviews) {
      html += `<div class="review-item">
        <div class="review-meta">
          ${review.author ? `<span class="author">${review.author}</span>` : ''}
          ${review.rating ? `<span class="stars">${'★'.repeat(Math.round(review.rating))}${'☆'.repeat(5 - Math.round(review.rating))}</span>` : ''}
          ${review.date ? `<span class="date">${review.date}</span>` : ''}
        </div>
        <p class="review-text">${review.text}</p>
      </div>`;
    }

    html += '</div></div>';
  }

  return html;
}
```

**Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat(customer-reviews): frontend tab met formulier en review weergave"
```

---

## Task 10: API Documentatie

**Files:**
- Modify: `public/docs.html`

**Step 1: Add endpoint documentation**

Voeg een sectie toe voor `POST /api/customer-reviews` met:
- Endpoint URL
- Request body (businessName, domain)
- Response format (platforms array met reviews)
- Voorbeeld curl commando
- Voorbeeld response

**Step 2: Commit**

```bash
git add public/docs.html
git commit -m "docs: customer-reviews endpoint documentatie"
```

---

## Task 11: Integration Test

**Files:**
- Create: `src/services/__tests__/customer-reviews-integration.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { customerReviewsRoutes } from '../../routes/customer-reviews';
import { CustomerReviewsOrchestrator } from '../customer-reviews-orchestrator';

describe('POST /api/customer-reviews', () => {
  it('should return 400 for missing businessName', async () => {
    const fastify = Fastify();
    const mockOrchestrator = {} as CustomerReviewsOrchestrator;
    await customerReviewsRoutes(fastify, mockOrchestrator);

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/customer-reviews',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Invalid request');
  });

  it('should return 400 for empty businessName', async () => {
    const fastify = Fastify();
    const mockOrchestrator = {} as CustomerReviewsOrchestrator;
    await customerReviewsRoutes(fastify, mockOrchestrator);

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/customer-reviews',
      payload: { businessName: '' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('should call orchestrator with correct params', async () => {
    const fastify = Fastify();
    const mockOrchestrator = {
      scrape: vi.fn().mockResolvedValue({
        businessName: 'Test',
        platforms: [],
        cached: false,
        scrapedAt: new Date().toISOString(),
      }),
    } as any;
    await customerReviewsRoutes(fastify, mockOrchestrator);

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/customer-reviews',
      payload: { businessName: 'Test Bedrijf', domain: 'test.nl' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.scrape).toHaveBeenCalledWith('Test Bedrijf', 'test.nl');
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/services/__tests__/customer-reviews-integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/services/__tests__/customer-reviews-integration.test.ts
git commit -m "test: integration tests voor customer-reviews endpoint"
```

---

## Task 12: Run All Tests & Final Verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 2: Start dev server and test manually**

Run: `npm run dev`
Test: Open browser, check new Reviews tab, submit a test request

**Step 3: Build check**

Run: `npm run build`
Expected: No TypeScript errors
