# Vacancy Scraper Design

## Doel

Een API-first scraper die op basis van een domeinnaam detecteert of een bedrijf vacatures heeft en deze gestructureerd teruggeeft. Primair voor lead generation, met ruimte voor uitbreiding.

## Architectuur

```
┌─────────────────┐
│   API Client    │  ← Extern systeem roept dit aan
└────────┬────────┘
         │ POST /api/scrape { domain: "example.nl" }
         ▼
┌─────────────────┐
│   Fastify API   │  ← TypeScript, deployed via Forge
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Cache Check    │  ← Redis: al gescraped < 24 uur?
└────────┬────────┘
         │ miss
         ▼
┌─────────────────┐
│ Career Page     │  ← Zoekt /careers, /jobs, /vacatures, etc.
│ Discovery       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Platform Check  │  ← Recruitee? Greenhouse? Lever?
└────────┬────────┘
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────────┐
│Parser │ │Claude AI  │  ← Bekend platform vs. custom site
└───┬───┘ └─────┬─────┘
    └─────┬─────┘
          ▼
┌─────────────────┐
│ Vacancy Objects │  ← Gestandaardiseerde JSON output
└─────────────────┘
```

## Data Model

### Vacancy Object

```typescript
interface Vacancy {
  // Basis
  id: string;                    // Unieke hash van URL
  title: string;                 // "Senior Backend Developer"
  url: string;                   // Link naar de vacature
  location: string | null;       // "Amsterdam" of "Remote"

  // Details
  description: string;           // Volledige beschrijving
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
    period: string | null;       // "year", "month", "hour"
  } | null;
  type: string | null;           // "fulltime", "parttime", "contract"

  // Geëxtraheerd door AI
  skills: string[];              // ["TypeScript", "PostgreSQL", "AWS"]
  seniority: string | null;      // "junior", "medior", "senior", "lead"
  department: string | null;     // "Engineering", "Marketing"

  // Metadata
  publishedAt: string | null;    // ISO date indien gevonden
  daysOpen: number | null;       // Berekend: dagen sinds publicatie
  scrapedAt: string;             // Wanneer wij het ophaalden
  confidence: number;            // 0-1: hoe zeker is de AI extractie
}
```

### API Response

```typescript
interface ScrapeResponse {
  domain: string;
  hasVacancies: boolean;
  vacancyCount: number;
  vacancies: Vacancy[];
  source: {
    platform: string | null;     // "recruitee", "greenhouse", of null
    careerPageUrl: string;
    method: "parser" | "ai";
  };
  cached: boolean;
  scrapedAt: string;
}
```

## Technische Stack

### Dependencies

- `fastify` - API framework
- `playwright` - Browser automation
- `@anthropic-ai/sdk` - Claude API
- `ioredis` - Redis client voor cache
- `zod` - Input validatie

### Project Structuur

```
vacancy-scraper/
├── src/
│   ├── index.ts                 # Fastify server setup
│   ├── routes/
│   │   └── scrape.ts            # POST /api/scrape endpoint
│   ├── services/
│   │   ├── discovery.ts         # Vindt career page URLs
│   │   ├── scraper.ts           # HTTP + Playwright fallback
│   │   ├── platforms/           # Bekende platform parsers
│   │   │   ├── recruitee.ts
│   │   │   ├── greenhouse.ts
│   │   │   ├── lever.ts
│   │   │   └── workable.ts
│   │   ├── ai-extractor.ts      # Claude integratie
│   │   └── cache.ts             # Redis cache layer
│   ├── types/
│   │   └── vacancy.ts           # TypeScript interfaces
│   └── utils/
│       └── url.ts               # URL helpers
├── package.json
├── tsconfig.json
└── .env                         # API keys
```

### Deployment

- Node.js 20+ server via Forge
- Redis instance (of Upstash voor managed)
- Environment variables voor API keys

## Scrape Flow

### Stap 1: Career Page Discovery

```
Input: "acme.nl"
    ↓
Probeer URLs parallel:
- acme.nl/careers
- acme.nl/jobs
- acme.nl/vacatures
- acme.nl/werken-bij
- acme.nl/werkenbij
    ↓
Check ook: links op homepage met keywords "careers", "jobs", "vacatures"
    ↓
Output: careerPageUrl of null
```

### Stap 2: Platform Detectie

```
Check URL/HTML voor bekende patronen:
- "recruitee.com" in iframe/scripts → Recruitee parser
- "boards.greenhouse.io" → Greenhouse parser
- "jobs.lever.co" → Lever parser
- Geen match → AI extractie
```

### Stap 3: Smart Fetch

```
Eerst: Snelle HTTP request
    ↓
Check: Is content geladen?
    ↓
Nee → Playwright headless browser retry
    ↓
Output: HTML content
```

### Stap 4: Extractie

- **Platform parser**: Volgt bekende API/HTML structuur
- **Claude AI**: Analyseert HTML, extraheert vacatures als JSON met confidence score

## API Specificatie

### Endpoint

```
POST /api/scrape
Content-Type: application/json
Authorization: Bearer <api-key>

{
  "domain": "acme.nl"
}
```

### Responses

| Status | Betekenis |
|--------|-----------|
| 200 | Succes |
| 400 | Ongeldig domein format |
| 404 | Geen career page gevonden |
| 429 | Rate limit (60 req/min) |
| 500 | Scrape mislukt |

### Timeouts

- HTTP fetch: 10 seconden
- Playwright: 30 seconden
- Claude API: 60 seconden
- Totale request: max 90 seconden

## Caching

- Redis-based cache
- TTL: 24 uur
- Key: domain hash
- Voorkomt dubbele requests en respecteert websites

## AI Integratie

- Provider: Anthropic Claude
- Hybrid aanpak: AI alleen voor onbekende sites
- Structured output met Zod validatie
- Confidence scores per geëxtraheerd veld
