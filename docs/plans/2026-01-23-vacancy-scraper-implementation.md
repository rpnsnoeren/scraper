# Vacancy Scraper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an API that scrapes company websites to detect and extract job vacancies.

**Architecture:** Fastify API with hybrid scraping (HTTP + Playwright fallback), platform-specific parsers for known job boards, Claude AI extraction for unknown sites, Redis caching.

**Tech Stack:** TypeScript, Fastify, Playwright, Anthropic SDK, ioredis, Zod

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Initialize package.json**

```bash
cd /Users/remcosnoeren/Documents/scraper
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install fastify @fastify/cors @anthropic-ai/sdk ioredis zod playwright dotenv
npm install -D typescript @types/node tsx vitest
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create .env.example**

```
ANTHROPIC_API_KEY=your_api_key_here
REDIS_URL=redis://localhost:6379
PORT=3000
API_KEY=your_secret_api_key
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
.env
*.log
```

**Step 6: Update package.json scripts**

Add to package.json:
```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest"
  }
}
```

**Step 7: Install Playwright browsers**

```bash
npx playwright install chromium
```

**Step 8: Commit**

```bash
git init
git add .
git commit -m "chore: initial project setup with dependencies"
```

---

## Task 2: Type Definitions

**Files:**
- Create: `src/types/vacancy.ts`

**Step 1: Create types directory and vacancy types**

```typescript
// src/types/vacancy.ts
import { z } from 'zod';

export const SalarySchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  currency: z.string().nullable(),
  period: z.enum(['year', 'month', 'hour']).nullable(),
});

export const VacancySchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  location: z.string().nullable(),
  description: z.string(),
  salary: SalarySchema.nullable(),
  type: z.enum(['fulltime', 'parttime', 'contract', 'internship']).nullable(),
  skills: z.array(z.string()),
  seniority: z.enum(['junior', 'medior', 'senior', 'lead']).nullable(),
  department: z.string().nullable(),
  publishedAt: z.string().nullable(),
  daysOpen: z.number().nullable(),
  scrapedAt: z.string(),
  confidence: z.number().min(0).max(1),
});

export const ScrapeResponseSchema = z.object({
  domain: z.string(),
  hasVacancies: z.boolean(),
  vacancyCount: z.number(),
  vacancies: z.array(VacancySchema),
  source: z.object({
    platform: z.string().nullable(),
    careerPageUrl: z.string(),
    method: z.enum(['parser', 'ai']),
  }),
  cached: z.boolean(),
  scrapedAt: z.string(),
});

export type Salary = z.infer<typeof SalarySchema>;
export type Vacancy = z.infer<typeof VacancySchema>;
export type ScrapeResponse = z.infer<typeof ScrapeResponseSchema>;

export const ScrapeRequestSchema = z.object({
  domain: z.string().min(1).refine(
    (val) => /^[a-zA-Z0-9][a-zA-Z0-9-_.]+\.[a-zA-Z]{2,}$/.test(val),
    { message: 'Invalid domain format' }
  ),
});

export type ScrapeRequest = z.infer<typeof ScrapeRequestSchema>;
```

**Step 2: Commit**

```bash
git add src/types/
git commit -m "feat: add TypeScript type definitions with Zod schemas"
```

---

## Task 3: Cache Service

**Files:**
- Create: `src/services/cache.ts`
- Create: `src/services/__tests__/cache.test.ts`

**Step 1: Write failing test for cache**

```typescript
// src/services/__tests__/cache.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheService } from '../cache';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
  });

  it('should return null for cache miss', async () => {
    const result = await cache.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should return cached value for cache hit', async () => {
    const data = { domain: 'test.nl', hasVacancies: true };
    await cache.set('test-key', data, 3600);
    const result = await cache.get('test-key');
    expect(result).toEqual(data);
  });

  it('should generate consistent cache key from domain', () => {
    const key1 = cache.keyFor('example.nl');
    const key2 = cache.keyFor('example.nl');
    const key3 = cache.keyFor('other.nl');
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- src/services/__tests__/cache.test.ts
```

Expected: FAIL - module not found

**Step 3: Implement cache service**

```typescript
// src/services/cache.ts
import { Redis } from 'ioredis';
import { createHash } from 'crypto';

export class CacheService {
  private redis: Redis | null = null;
  private memoryCache: Map<string, { data: unknown; expires: number }> = new Map();
  private ttl = 24 * 60 * 60; // 24 hours

  constructor(redisUrl?: string) {
    if (redisUrl) {
      this.redis = new Redis(redisUrl);
    }
  }

  keyFor(domain: string): string {
    return `vacancy:${createHash('sha256').update(domain.toLowerCase()).digest('hex').slice(0, 16)}`;
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.redis) {
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    }

    const cached = this.memoryCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data as T;
    }
    this.memoryCache.delete(key);
    return null;
  }

  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    const expiry = ttl ?? this.ttl;

    if (this.redis) {
      await this.redis.setex(key, expiry, JSON.stringify(data));
    } else {
      this.memoryCache.set(key, {
        data,
        expires: Date.now() + expiry * 1000,
      });
    }
  }

  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- src/services/__tests__/cache.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/
git commit -m "feat: add cache service with Redis and memory fallback"
```

---

## Task 4: URL Utilities

**Files:**
- Create: `src/utils/url.ts`
- Create: `src/utils/__tests__/url.test.ts`

**Step 1: Write failing tests**

```typescript
// src/utils/__tests__/url.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeUrl, getCareerPageCandidates, extractDomain } from '../url';

describe('URL utilities', () => {
  describe('normalizeUrl', () => {
    it('should add https if missing', () => {
      expect(normalizeUrl('example.nl')).toBe('https://example.nl');
    });

    it('should keep https if present', () => {
      expect(normalizeUrl('https://example.nl')).toBe('https://example.nl');
    });

    it('should upgrade http to https', () => {
      expect(normalizeUrl('http://example.nl')).toBe('https://example.nl');
    });
  });

  describe('getCareerPageCandidates', () => {
    it('should return common career page paths', () => {
      const candidates = getCareerPageCandidates('example.nl');
      expect(candidates).toContain('https://example.nl/careers');
      expect(candidates).toContain('https://example.nl/jobs');
      expect(candidates).toContain('https://example.nl/vacatures');
      expect(candidates).toContain('https://example.nl/werken-bij');
    });
  });

  describe('extractDomain', () => {
    it('should extract domain from URL', () => {
      expect(extractDomain('https://www.example.nl/page')).toBe('example.nl');
    });

    it('should handle subdomains', () => {
      expect(extractDomain('https://careers.example.nl')).toBe('example.nl');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- src/utils/__tests__/url.test.ts
```

Expected: FAIL

**Step 3: Implement URL utilities**

```typescript
// src/utils/url.ts
export function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url.replace(/^http:\/\//, 'https://');
}

export function getCareerPageCandidates(domain: string): string[] {
  const base = normalizeUrl(domain);
  const paths = [
    '/careers',
    '/jobs',
    '/vacatures',
    '/werken-bij',
    '/werkenbij',
    '/over-ons/vacatures',
    '/nl/careers',
    '/nl/vacatures',
    '/en/careers',
    '/join-us',
    '/join',
    '/team',
  ];

  return paths.map(path => `${base}${path}`);
}

export function extractDomain(url: string): string {
  try {
    const parsed = new URL(normalizeUrl(url));
    const parts = parsed.hostname.split('.');
    // Handle www and other common subdomains
    if (parts.length > 2 && ['www', 'careers', 'jobs', 'werkenbij'].includes(parts[0])) {
      return parts.slice(1).join('.');
    }
    return parsed.hostname;
  } catch {
    return url;
  }
}

export function createVacancyId(url: string): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(url).digest('hex').slice(0, 12);
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- src/utils/__tests__/url.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/
git commit -m "feat: add URL utility functions"
```

---

## Task 5: Scraper Service (HTTP + Playwright)

**Files:**
- Create: `src/services/scraper.ts`
- Create: `src/services/__tests__/scraper.test.ts`

**Step 1: Write failing tests**

```typescript
// src/services/__tests__/scraper.test.ts
import { describe, it, expect } from 'vitest';
import { ScraperService } from '../scraper';

describe('ScraperService', () => {
  const scraper = new ScraperService();

  it('should detect if page needs JavaScript', () => {
    const htmlWithContent = '<html><body><div class="jobs"><h2>Developer</h2></div></body></html>';
    const htmlEmpty = '<html><body><div id="root"></div><script src="app.js"></script></body></html>';

    expect(scraper.needsJavaScript(htmlEmpty)).toBe(true);
    expect(scraper.needsJavaScript(htmlWithContent)).toBe(false);
  });

  it('should extract links from HTML', () => {
    const html = `
      <html><body>
        <a href="/careers">Careers</a>
        <a href="https://jobs.example.nl">Jobs</a>
        <a href="/contact">Contact</a>
      </body></html>
    `;
    const links = scraper.extractCareerLinks(html, 'https://example.nl');
    expect(links.some(l => l.includes('careers'))).toBe(true);
    expect(links.some(l => l.includes('jobs'))).toBe(true);
    expect(links.some(l => l.includes('contact'))).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- src/services/__tests__/scraper.test.ts
```

**Step 3: Implement scraper service**

```typescript
// src/services/scraper.ts
import { chromium, Browser, Page } from 'playwright';

export class ScraperService {
  private browser: Browser | null = null;

  needsJavaScript(html: string): boolean {
    // Check for common SPA indicators
    const spaIndicators = [
      /<div id="(root|app|__next)">\s*<\/div>/i,
      /loading\.\.\./i,
      /<noscript>.*enable javascript/i,
    ];

    const hasContent = /<(h1|h2|h3|p|li|article)[^>]*>[^<]{20,}/i.test(html);
    const hasSpaIndicator = spaIndicators.some(pattern => pattern.test(html));

    return hasSpaIndicator && !hasContent;
  }

  extractCareerLinks(html: string, baseUrl: string): string[] {
    const careerKeywords = ['career', 'jobs', 'vacatur', 'werken', 'join', 'hiring', 'openings'];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)/gi;
    const links: string[] = [];

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const [, href, text] = match;
      const lowerHref = href.toLowerCase();
      const lowerText = text.toLowerCase();

      if (careerKeywords.some(kw => lowerHref.includes(kw) || lowerText.includes(kw))) {
        try {
          const fullUrl = new URL(href, baseUrl).href;
          links.push(fullUrl);
        } catch {
          // Invalid URL, skip
        }
      }
    }

    return [...new Set(links)];
  }

  async fetchWithHttp(url: string, timeout = 10000): Promise<{ html: string; status: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VacancyBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });

      const html = await response.text();
      return { html, status: response.status };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async fetchWithPlaywright(url: string, timeout = 30000): Promise<string> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }

    const page = await this.browser.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout });
      // Wait a bit for dynamic content
      await page.waitForTimeout(2000);
      return await page.content();
    } finally {
      await page.close();
    }
  }

  async fetch(url: string): Promise<{ html: string; usedPlaywright: boolean }> {
    try {
      const { html, status } = await this.fetchWithHttp(url);

      if (status === 200 && !this.needsJavaScript(html)) {
        return { html, usedPlaywright: false };
      }
    } catch {
      // HTTP failed, try Playwright
    }

    const html = await this.fetchWithPlaywright(url);
    return { html, usedPlaywright: true };
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- src/services/__tests__/scraper.test.ts
```

**Step 5: Commit**

```bash
git add src/services/scraper.ts src/services/__tests__/scraper.test.ts
git commit -m "feat: add scraper service with HTTP and Playwright fallback"
```

---

## Task 6: Career Page Discovery

**Files:**
- Create: `src/services/discovery.ts`
- Create: `src/services/__tests__/discovery.test.ts`

**Step 1: Write failing tests**

```typescript
// src/services/__tests__/discovery.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DiscoveryService } from '../discovery';
import { ScraperService } from '../scraper';

describe('DiscoveryService', () => {
  it('should detect known platforms from URL', () => {
    const discovery = new DiscoveryService(new ScraperService());

    expect(discovery.detectPlatform('https://company.recruitee.com')).toBe('recruitee');
    expect(discovery.detectPlatform('https://boards.greenhouse.io/company')).toBe('greenhouse');
    expect(discovery.detectPlatform('https://jobs.lever.co/company')).toBe('lever');
    expect(discovery.detectPlatform('https://company.nl/careers')).toBeNull();
  });

  it('should detect platform from HTML content', () => {
    const discovery = new DiscoveryService(new ScraperService());

    const recruiteeHtml = '<script src="https://d3ii2lldyojfer.cloudfront.net"></script>';
    const greenhouseHtml = '<div id="greenhouse-jobboard">';
    const regularHtml = '<div class="jobs-list">';

    expect(discovery.detectPlatformFromHtml(recruiteeHtml)).toBe('recruitee');
    expect(discovery.detectPlatformFromHtml(greenhouseHtml)).toBe('greenhouse');
    expect(discovery.detectPlatformFromHtml(regularHtml)).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- src/services/__tests__/discovery.test.ts
```

**Step 3: Implement discovery service**

```typescript
// src/services/discovery.ts
import { ScraperService } from './scraper';
import { getCareerPageCandidates, normalizeUrl } from '../utils/url';

export type Platform = 'recruitee' | 'greenhouse' | 'lever' | 'workable' | null;

export class DiscoveryService {
  constructor(private scraper: ScraperService) {}

  detectPlatform(url: string): Platform {
    const lower = url.toLowerCase();

    if (lower.includes('recruitee.com')) return 'recruitee';
    if (lower.includes('greenhouse.io')) return 'greenhouse';
    if (lower.includes('lever.co')) return 'lever';
    if (lower.includes('workable.com')) return 'workable';

    return null;
  }

  detectPlatformFromHtml(html: string): Platform {
    const lower = html.toLowerCase();

    if (lower.includes('recruitee') || lower.includes('d3ii2lldyojfer.cloudfront.net')) {
      return 'recruitee';
    }
    if (lower.includes('greenhouse-jobboard') || lower.includes('boards.greenhouse.io')) {
      return 'greenhouse';
    }
    if (lower.includes('lever-jobs') || lower.includes('jobs.lever.co')) {
      return 'lever';
    }
    if (lower.includes('workable-careers')) {
      return 'workable';
    }

    return null;
  }

  async findCareerPage(domain: string): Promise<{
    url: string;
    html: string;
    platform: Platform;
  } | null> {
    const candidates = getCareerPageCandidates(domain);

    // Try candidates in parallel batches
    for (let i = 0; i < candidates.length; i += 3) {
      const batch = candidates.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map(async (url) => {
          const { html } = await this.scraper.fetch(url);
          return { url, html };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { url, html } = result.value;
          // Check if this looks like a career page
          if (this.looksLikeCareerPage(html)) {
            const platform = this.detectPlatform(url) || this.detectPlatformFromHtml(html);
            return { url, html, platform };
          }
        }
      }
    }

    // Try homepage and look for career links
    try {
      const { html } = await this.scraper.fetch(normalizeUrl(domain));
      const careerLinks = this.scraper.extractCareerLinks(html, normalizeUrl(domain));

      for (const link of careerLinks.slice(0, 3)) {
        try {
          const { html: careerHtml } = await this.scraper.fetch(link);
          if (this.looksLikeCareerPage(careerHtml)) {
            const platform = this.detectPlatform(link) || this.detectPlatformFromHtml(careerHtml);
            return { url: link, html: careerHtml, platform };
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Homepage not accessible
    }

    return null;
  }

  private looksLikeCareerPage(html: string): boolean {
    const lower = html.toLowerCase();
    const careerIndicators = [
      'vacancy', 'vacancies', 'vacature', 'vacatures',
      'job opening', 'job listings', 'open position',
      'we are hiring', 'join our team', 'career',
      'werken bij', 'kom werken',
    ];

    return careerIndicators.some(indicator => lower.includes(indicator));
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- src/services/__tests__/discovery.test.ts
```

**Step 5: Commit**

```bash
git add src/services/discovery.ts src/services/__tests__/discovery.test.ts
git commit -m "feat: add career page discovery service"
```

---

## Task 7: Platform Parsers (Recruitee)

**Files:**
- Create: `src/services/platforms/recruitee.ts`
- Create: `src/services/platforms/__tests__/recruitee.test.ts`
- Create: `src/services/platforms/index.ts`

**Step 1: Write failing tests**

```typescript
// src/services/platforms/__tests__/recruitee.test.ts
import { describe, it, expect } from 'vitest';
import { RecruiteeParser } from '../recruitee';

describe('RecruiteeParser', () => {
  const parser = new RecruiteeParser();

  it('should extract company ID from URL', () => {
    expect(parser.extractCompanyId('https://acme.recruitee.com')).toBe('acme');
    expect(parser.extractCompanyId('https://acme.recruitee.com/o/developer')).toBe('acme');
  });

  it('should parse vacancy from API response', () => {
    const apiOffer = {
      id: 123,
      title: 'Senior Developer',
      city: 'Amsterdam',
      careers_url: 'https://acme.recruitee.com/o/senior-developer',
      description: 'We are looking for...',
      created_at: '2026-01-01T10:00:00Z',
      department: { name: 'Engineering' },
      employment_type_code: 'full_time',
    };

    const vacancy = parser.parseVacancy(apiOffer, 'https://acme.recruitee.com');

    expect(vacancy.title).toBe('Senior Developer');
    expect(vacancy.location).toBe('Amsterdam');
    expect(vacancy.department).toBe('Engineering');
    expect(vacancy.type).toBe('fulltime');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- src/services/platforms/__tests__/recruitee.test.ts
```

**Step 3: Implement Recruitee parser**

```typescript
// src/services/platforms/recruitee.ts
import { Vacancy } from '../../types/vacancy';
import { createVacancyId } from '../../utils/url';

interface RecruiteeOffer {
  id: number;
  title: string;
  city?: string;
  country?: string;
  careers_url: string;
  description: string;
  created_at: string;
  department?: { name: string };
  employment_type_code?: string;
  min_salary?: number;
  max_salary?: number;
  salary_currency?: string;
  salary_period?: string;
}

export class RecruiteeParser {
  extractCompanyId(url: string): string | null {
    const match = url.match(/https?:\/\/([^.]+)\.recruitee\.com/);
    return match ? match[1] : null;
  }

  async fetchVacancies(companyId: string): Promise<RecruiteeOffer[]> {
    const apiUrl = `https://${companyId}.recruitee.com/api/offers`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`Recruitee API error: ${response.status}`);
    }

    const data = await response.json();
    return data.offers || [];
  }

  parseVacancy(offer: RecruiteeOffer, baseUrl: string): Vacancy {
    const now = new Date().toISOString();
    const publishedAt = offer.created_at;
    const daysOpen = publishedAt
      ? Math.floor((Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      id: createVacancyId(offer.careers_url),
      title: offer.title,
      url: offer.careers_url,
      location: [offer.city, offer.country].filter(Boolean).join(', ') || null,
      description: offer.description,
      salary: offer.min_salary || offer.max_salary ? {
        min: offer.min_salary ?? null,
        max: offer.max_salary ?? null,
        currency: offer.salary_currency ?? null,
        period: this.mapSalaryPeriod(offer.salary_period),
      } : null,
      type: this.mapEmploymentType(offer.employment_type_code),
      skills: [], // Recruitee API doesn't provide skills directly
      seniority: null, // Would need AI to extract
      department: offer.department?.name ?? null,
      publishedAt,
      daysOpen,
      scrapedAt: now,
      confidence: 1, // Direct API data is highly reliable
    };
  }

  private mapEmploymentType(code?: string): Vacancy['type'] {
    const map: Record<string, Vacancy['type']> = {
      'full_time': 'fulltime',
      'part_time': 'parttime',
      'contract': 'contract',
      'internship': 'internship',
    };
    return code ? map[code] ?? null : null;
  }

  private mapSalaryPeriod(period?: string): 'year' | 'month' | 'hour' | null {
    if (!period) return null;
    const lower = period.toLowerCase();
    if (lower.includes('year') || lower.includes('annual')) return 'year';
    if (lower.includes('month')) return 'month';
    if (lower.includes('hour')) return 'hour';
    return null;
  }

  async parse(url: string): Promise<Vacancy[]> {
    const companyId = this.extractCompanyId(url);
    if (!companyId) {
      throw new Error('Could not extract company ID from Recruitee URL');
    }

    const offers = await this.fetchVacancies(companyId);
    return offers.map(offer => this.parseVacancy(offer, url));
  }
}
```

**Step 4: Create platforms index**

```typescript
// src/services/platforms/index.ts
import { Platform } from '../discovery';
import { Vacancy } from '../../types/vacancy';
import { RecruiteeParser } from './recruitee';

export async function parseWithPlatform(platform: Platform, url: string): Promise<Vacancy[] | null> {
  switch (platform) {
    case 'recruitee':
      return new RecruiteeParser().parse(url);
    // TODO: Add other parsers
    default:
      return null;
  }
}

export { RecruiteeParser };
```

**Step 5: Run tests to verify they pass**

```bash
npm test -- src/services/platforms/__tests__/recruitee.test.ts
```

**Step 6: Commit**

```bash
git add src/services/platforms/
git commit -m "feat: add Recruitee platform parser"
```

---

## Task 8: AI Extractor (Claude)

**Files:**
- Create: `src/services/ai-extractor.ts`
- Create: `src/services/__tests__/ai-extractor.test.ts`

**Step 1: Write failing tests**

```typescript
// src/services/__tests__/ai-extractor.test.ts
import { describe, it, expect } from 'vitest';
import { AIExtractor } from '../ai-extractor';

describe('AIExtractor', () => {
  it('should build correct prompt', () => {
    const extractor = new AIExtractor('test-key');
    const prompt = extractor.buildPrompt('<html><body>Jobs page</body></html>', 'https://example.nl/careers');

    expect(prompt).toContain('JSON');
    expect(prompt).toContain('vacatures');
    expect(prompt).toContain('example.nl');
  });

  it('should clean HTML before sending', () => {
    const extractor = new AIExtractor('test-key');
    const html = `
      <html>
        <head><script>var x = 1;</script><style>.a{}</style></head>
        <body><div class="job">Developer</div></body>
      </html>
    `;
    const cleaned = extractor.cleanHtml(html);

    expect(cleaned).not.toContain('<script>');
    expect(cleaned).not.toContain('<style>');
    expect(cleaned).toContain('Developer');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- src/services/__tests__/ai-extractor.test.ts
```

**Step 3: Implement AI extractor**

```typescript
// src/services/ai-extractor.ts
import Anthropic from '@anthropic-ai/sdk';
import { Vacancy, VacancySchema } from '../types/vacancy';
import { createVacancyId } from '../utils/url';
import { z } from 'zod';

const AIVacancySchema = z.object({
  title: z.string(),
  url: z.string().optional(),
  location: z.string().nullable(),
  description: z.string(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  salary_currency: z.string().nullable(),
  salary_period: z.string().nullable(),
  type: z.string().nullable(),
  skills: z.array(z.string()),
  seniority: z.string().nullable(),
  department: z.string().nullable(),
  published_date: z.string().nullable(),
});

const AIResponseSchema = z.object({
  vacancies: z.array(AIVacancySchema),
  confidence: z.number().min(0).max(1),
});

export class AIExtractor {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  cleanHtml(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50000); // Limit to ~50k chars
  }

  buildPrompt(html: string, url: string): string {
    const cleanedHtml = this.cleanHtml(html);
    const domain = new URL(url).hostname;

    return `Analyseer de volgende tekst van een career/vacature pagina van ${domain} en extraheer alle vacatures.

Voor elke vacature, extraheer:
- title: functietitel
- url: link naar de vacature (relatief of absoluut)
- location: locatie (stad, land, of "Remote")
- description: korte beschrijving (max 500 tekens)
- salary_min/salary_max/salary_currency/salary_period: salaris info indien beschikbaar
- type: "fulltime", "parttime", "contract", of "internship"
- skills: lijst van gevraagde skills/technologieën
- seniority: "junior", "medior", "senior", of "lead"
- department: afdeling (bijv. "Engineering", "Marketing")
- published_date: publicatiedatum in ISO format indien zichtbaar

Geef je antwoord als JSON met dit formaat:
{
  "vacancies": [...],
  "confidence": 0.0-1.0 (hoe zeker je bent over de extractie)
}

Als er geen vacatures zijn, geef een lege array.

Tekst van de pagina:
${cleanedHtml}`;
  }

  async extract(html: string, url: string): Promise<{ vacancies: Vacancy[]; confidence: number }> {
    const prompt = this.buildPrompt(html, url);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Extract JSON from response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Claude response');
    }

    const parsed = AIResponseSchema.parse(JSON.parse(jsonMatch[0]));
    const now = new Date().toISOString();

    const vacancies: Vacancy[] = parsed.vacancies.map((v) => {
      const vacancyUrl = v.url
        ? (v.url.startsWith('http') ? v.url : new URL(v.url, url).href)
        : url;

      const publishedAt = v.published_date;
      const daysOpen = publishedAt
        ? Math.floor((Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        id: createVacancyId(vacancyUrl + v.title),
        title: v.title,
        url: vacancyUrl,
        location: v.location,
        description: v.description,
        salary: v.salary_min || v.salary_max ? {
          min: v.salary_min,
          max: v.salary_max,
          currency: v.salary_currency,
          period: this.mapPeriod(v.salary_period),
        } : null,
        type: this.mapType(v.type),
        skills: v.skills,
        seniority: this.mapSeniority(v.seniority),
        department: v.department,
        publishedAt,
        daysOpen,
        scrapedAt: now,
        confidence: parsed.confidence,
      };
    });

    return { vacancies, confidence: parsed.confidence };
  }

  private mapType(type: string | null): Vacancy['type'] {
    if (!type) return null;
    const lower = type.toLowerCase();
    if (lower.includes('full')) return 'fulltime';
    if (lower.includes('part')) return 'parttime';
    if (lower.includes('contract')) return 'contract';
    if (lower.includes('intern')) return 'internship';
    return null;
  }

  private mapSeniority(seniority: string | null): Vacancy['seniority'] {
    if (!seniority) return null;
    const lower = seniority.toLowerCase();
    if (lower.includes('junior')) return 'junior';
    if (lower.includes('medior') || lower.includes('mid')) return 'medior';
    if (lower.includes('senior')) return 'senior';
    if (lower.includes('lead') || lower.includes('principal')) return 'lead';
    return null;
  }

  private mapPeriod(period: string | null): 'year' | 'month' | 'hour' | null {
    if (!period) return null;
    const lower = period.toLowerCase();
    if (lower.includes('year') || lower.includes('annual') || lower.includes('jaar')) return 'year';
    if (lower.includes('month') || lower.includes('maand')) return 'month';
    if (lower.includes('hour') || lower.includes('uur')) return 'hour';
    return null;
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- src/services/__tests__/ai-extractor.test.ts
```

**Step 5: Commit**

```bash
git add src/services/ai-extractor.ts src/services/__tests__/ai-extractor.test.ts
git commit -m "feat: add AI extractor using Claude API"
```

---

## Task 9: Main Scrape Orchestrator

**Files:**
- Create: `src/services/orchestrator.ts`

**Step 1: Implement orchestrator**

```typescript
// src/services/orchestrator.ts
import { CacheService } from './cache';
import { ScraperService } from './scraper';
import { DiscoveryService } from './discovery';
import { AIExtractor } from './ai-extractor';
import { parseWithPlatform } from './platforms';
import { ScrapeResponse } from '../types/vacancy';

export class Orchestrator {
  private cache: CacheService;
  private scraper: ScraperService;
  private discovery: DiscoveryService;
  private aiExtractor: AIExtractor;

  constructor(config: { redisUrl?: string; anthropicApiKey: string }) {
    this.cache = new CacheService(config.redisUrl);
    this.scraper = new ScraperService();
    this.discovery = new DiscoveryService(this.scraper);
    this.aiExtractor = new AIExtractor(config.anthropicApiKey);
  }

  async scrape(domain: string): Promise<ScrapeResponse> {
    const cacheKey = this.cache.keyFor(domain);

    // Check cache
    const cached = await this.cache.get<ScrapeResponse>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    // Find career page
    const careerPage = await this.discovery.findCareerPage(domain);

    if (!careerPage) {
      const response: ScrapeResponse = {
        domain,
        hasVacancies: false,
        vacancyCount: 0,
        vacancies: [],
        source: {
          platform: null,
          careerPageUrl: '',
          method: 'ai',
        },
        cached: false,
        scrapedAt: new Date().toISOString(),
      };
      await this.cache.set(cacheKey, response);
      return response;
    }

    let vacancies;
    let method: 'parser' | 'ai';

    // Try platform parser first
    if (careerPage.platform) {
      const platformVacancies = await parseWithPlatform(careerPage.platform, careerPage.url);
      if (platformVacancies) {
        vacancies = platformVacancies;
        method = 'parser';
      }
    }

    // Fall back to AI extraction
    if (!vacancies) {
      const result = await this.aiExtractor.extract(careerPage.html, careerPage.url);
      vacancies = result.vacancies;
      method = 'ai';
    }

    const response: ScrapeResponse = {
      domain,
      hasVacancies: vacancies.length > 0,
      vacancyCount: vacancies.length,
      vacancies,
      source: {
        platform: careerPage.platform,
        careerPageUrl: careerPage.url,
        method,
      },
      cached: false,
      scrapedAt: new Date().toISOString(),
    };

    await this.cache.set(cacheKey, response);
    return response;
  }

  async close(): Promise<void> {
    await Promise.all([
      this.cache.close(),
      this.scraper.close(),
    ]);
  }
}
```

**Step 2: Commit**

```bash
git add src/services/orchestrator.ts
git commit -m "feat: add main scrape orchestrator"
```

---

## Task 10: API Routes

**Files:**
- Create: `src/routes/scrape.ts`

**Step 1: Implement scrape route**

```typescript
// src/routes/scrape.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Orchestrator } from '../services/orchestrator';
import { ScrapeRequestSchema } from '../types/vacancy';
import { ZodError } from 'zod';

export async function scrapeRoutes(fastify: FastifyInstance, orchestrator: Orchestrator) {
  // Simple API key auth
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.headers['authorization']?.replace('Bearer ', '');
    const expectedKey = process.env.API_KEY;

    if (!expectedKey || apiKey !== expectedKey) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  fastify.post('/api/scrape', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = ScrapeRequestSchema.parse(request.body);
      const result = await orchestrator.scrape(body.domain);
      return result;
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400).send({
          error: 'Invalid request',
          details: error.errors
        });
        return;
      }

      fastify.log.error(error);
      reply.code(500).send({ error: 'Scrape failed' });
    }
  });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok' };
  });
}
```

**Step 2: Commit**

```bash
git add src/routes/
git commit -m "feat: add API routes with authentication"
```

---

## Task 11: Server Entry Point

**Files:**
- Create: `src/index.ts`

**Step 1: Implement server**

```typescript
// src/index.ts
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Orchestrator } from './services/orchestrator';
import { scrapeRoutes } from './routes/scrape';

async function main() {
  const fastify = Fastify({
    logger: true,
  });

  await fastify.register(cors, {
    origin: true,
  });

  // Validate required env vars
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required');
  }

  const orchestrator = new Orchestrator({
    redisUrl: process.env.REDIS_URL,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Register routes
  await scrapeRoutes(fastify, orchestrator);

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    await orchestrator.close();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  const port = parseInt(process.env.PORT || '3000', 10);

  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server running on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
```

**Step 2: Create .env file for local development**

```bash
cp .env.example .env
# User needs to fill in their actual API keys
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add Fastify server entry point"
```

---

## Task 12: Final Integration Test

**Files:**
- Create: `src/__tests__/integration.test.ts`

**Step 1: Write integration test**

```typescript
// src/__tests__/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { Orchestrator } from '../services/orchestrator';
import { scrapeRoutes } from '../routes/scrape';

describe('API Integration', () => {
  const fastify = Fastify();

  beforeAll(async () => {
    // Mock orchestrator for testing
    const mockOrchestrator = {
      scrape: async (domain: string) => ({
        domain,
        hasVacancies: true,
        vacancyCount: 1,
        vacancies: [{
          id: 'test-123',
          title: 'Test Developer',
          url: `https://${domain}/careers/test`,
          location: 'Amsterdam',
          description: 'Test vacancy',
          salary: null,
          type: 'fulltime',
          skills: ['TypeScript'],
          seniority: 'senior',
          department: 'Engineering',
          publishedAt: '2026-01-01T00:00:00Z',
          daysOpen: 22,
          scrapedAt: new Date().toISOString(),
          confidence: 0.9,
        }],
        source: {
          platform: null,
          careerPageUrl: `https://${domain}/careers`,
          method: 'ai' as const,
        },
        cached: false,
        scrapedAt: new Date().toISOString(),
      }),
      close: async () => {},
    } as unknown as Orchestrator;

    process.env.API_KEY = 'test-key';
    await scrapeRoutes(fastify, mockOrchestrator);
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should return 401 without API key', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/scrape',
      payload: { domain: 'example.nl' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should return 400 for invalid domain', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/scrape',
      headers: { authorization: 'Bearer test-key' },
      payload: { domain: 'invalid' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('should scrape valid domain', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/scrape',
      headers: { authorization: 'Bearer test-key' },
      payload: { domain: 'example.nl' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.domain).toBe('example.nl');
    expect(body.hasVacancies).toBe(true);
    expect(body.vacancies).toHaveLength(1);
  });

  it('should return health check', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
  });
});
```

**Step 2: Run all tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/__tests__/
git commit -m "test: add API integration tests"
```

---

## Task 13: Documentation

**Files:**
- Create: `README.md`

**Step 1: Create README**

```markdown
# Vacancy Scraper API

API voor het detecteren en extraheren van vacatures van bedrijfswebsites.

## Setup

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Copy environment file
cp .env.example .env
# Fill in your API keys in .env

# Run development server
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key (required) |
| `REDIS_URL` | Redis connection URL (optional, uses memory cache if not set) |
| `PORT` | Server port (default: 3000) |
| `API_KEY` | Your API key for authentication |

## API Usage

### Scrape vacancies

```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"domain": "example.nl"}'
```

### Response

```json
{
  "domain": "example.nl",
  "hasVacancies": true,
  "vacancyCount": 3,
  "vacancies": [...],
  "source": {
    "platform": "recruitee",
    "careerPageUrl": "https://example.recruitee.com",
    "method": "parser"
  },
  "cached": false,
  "scrapedAt": "2026-01-23T12:00:00Z"
}
```

## Deployment (Forge)

1. Create a new site on Forge
2. Set Node.js version to 20+
3. Add environment variables
4. Deploy script:

```bash
npm install
npx playwright install chromium
npm run build
npm start
```
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and usage instructions"
```

---

## Summary

After completing all tasks, you will have:

1. A fully functional TypeScript API
2. Hybrid scraping (HTTP + Playwright)
3. Platform parsers (Recruitee, expandable)
4. AI extraction via Claude
5. Redis caching (24h TTL)
6. API authentication
7. Full test coverage
8. Deployment-ready for Forge
