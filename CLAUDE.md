# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Development server with hot reload (tsx watch)
npm run build        # TypeScript compilation to dist/
npm start            # Production server (node dist/index.js)
npm test             # Run all tests (vitest)
npx vitest run src/services/__tests__/cache.test.ts  # Run a single test file
```

Setup requires `npx playwright install chromium` after `npm install`.

## Environment Variables

- `ANTHROPIC_API_KEY` — Required. Claude API key for vacancy/detail extraction.
- `REDIS_URL` — Optional. Falls back to in-memory cache if unset.
- `PORT` — Optional, default 3000.
- `API_KEY` — Bearer token for `/api/scrape` authentication.

## Architecture

Multi-scraper API platform built on **Fastify + TypeScript**. Three independent scrapers share common infrastructure (caching, HTTP fetching).

### Layered Pattern

```
Route (Zod validation, auth) → Orchestrator (workflow, caching) → Services (fetching, extraction)
```

Each scraper follows this: a **route** validates input with Zod schemas from `src/types/`, delegates to an **orchestrator** that checks cache first, then coordinates **services** to fetch and transform data.

### Scrapers

| Endpoint | Orchestrator | Key Services |
|----------|-------------|-------------|
| `POST /api/scrape` | `Orchestrator` | DiscoveryService, AIExtractor, platform parsers, ScraperService |
| `POST /api/chatsync` | `ChatSyncOrchestrator` | DiscoveryService, ContentExtractor, ScraperService |
| `POST /api/google-ads` | `GoogleAdsOrchestrator` | GoogleAdsClient (direct RPC, no Playwright) |

### Key Services

- **ScraperService** (`scraper.ts`): Dual-fetch strategy — tries HTTP first, falls back to Playwright for JS-heavy pages. Detects SPAs via regex patterns.
- **DiscoveryService** (`discovery.ts`): Finds career pages via sitemap parsing, URL candidates, and HTML link extraction. Detects platforms (Recruitee, Greenhouse, Lever, Workable).
- **AIExtractor** (`ai-extractor.ts`): Claude 3.5 Haiku for vacancy extraction from HTML. Separate prompts for overview vs detail extraction.
- **CacheService** (`cache.ts`): Redis with automatic in-memory Map fallback. 24-hour TTL.
- **GoogleAdsClient** (`google-ads-client.ts`): Calls Google Ads Transparency Center RPC endpoints directly via HTTP POST. Protobuf-style JSON with numeric keys. No authentication needed.

### Adding a New Scraper

1. Create Zod schemas in `src/types/<name>.ts`
2. Create orchestrator in `src/services/<name>-orchestrator.ts` (cache-first pattern)
3. Create route in `src/routes/<name>.ts` (Zod validation, error handling)
4. Register in `src/index.ts` (import, instantiate, `await routes(fastify, orchestrator)`)
5. Add tab + panel + JS functions in `public/index.html`
6. Add endpoint docs in `public/docs.html`

### Platform Parsers

Platform-specific vacancy parsers live in `src/services/platforms/`. The dispatcher in `platforms/index.ts` routes to the correct parser based on detected platform. Add new platforms by creating a parser class with `async parse(url: string): Promise<Vacancy[]>` and registering it in the switch.

## Frontend

Single-page HTML app at `public/index.html` with tabbed interface. Each scraper has its own tab, form, curl preview, and result renderer. All inline JS — no build step.

## Testing

Tests use **Vitest** with no config file. Unit tests are colocated: `src/services/__tests__/`, `src/utils/__tests__/`, `src/services/platforms/__tests__/`. Integration tests mock orchestrators to test route validation and auth.
