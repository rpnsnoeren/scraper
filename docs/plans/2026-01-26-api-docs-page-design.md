# API Documentation Page Design

## Overview

Een standalone Swagger-achtige API documentatie pagina met try-it-out functionaliteit en kopieerbare curl commands.

## Beslissingen

- **Locatie:** Aparte pagina op `/docs`
- **Stijl:** Swagger/OpenAPI met try-it-out functionaliteit
- **Authenticatie:** Placeholder `YOUR_API_KEY` met instructie

## Pagina Structuur

```
┌─────────────────────────────────────────────────────┐
│  Header: "Vacancy Scraper API Documentation"        │
├─────────────────────────────────────────────────────┤
│  Authentication Sectie                              │
│  - Bearer token uitleg                              │
│  - "Vervang YOUR_API_KEY met jouw API sleutel"     │
├─────────────────────────────────────────────────────┤
│  Base URL Sectie                                    │
├─────────────────────────────────────────────────────┤
│  Endpoints                                          │
│  ├── POST /api/scrape (expandable)                 │
│  │   ├── Beschrijving                               │
│  │   ├── Parameters tabel                           │
│  │   ├── Request Body + Copy                        │
│  │   ├── Curl Command + Copy                        │
│  │   ├── Try It Out (form + execute)               │
│  │   └── Response Schema                            │
│  └── GET /health                                    │
├─────────────────────────────────────────────────────┤
│  Error Codes (400, 401, 500)                        │
├─────────────────────────────────────────────────────┤
│  Footer: Link naar API Tester                       │
└─────────────────────────────────────────────────────┘
```

## Error Codes

| Code | Status | Beschrijving |
|------|--------|--------------|
| 200 | OK | Succesvolle scrape |
| 400 | Bad Request | Ongeldige domain of parameters |
| 401 | Unauthorized | Ontbrekende of ongeldige API key |
| 500 | Server Error | Scraping mislukt |

## Response Schema

### Vacancy Object

| Veld | Type | Beschrijving |
|------|------|--------------|
| id | string | Unieke identifier |
| title | string | Vacature titel |
| url | string | Link naar vacature |
| location | string? | Locatie |
| description | string? | Korte beschrijving |
| salary | object? | min, max, currency, period |
| type | string? | fulltime/parttime/contract/internship |
| seniority | string? | junior/medior/senior/lead |
| department | string? | Afdeling |
| skills | string[] | Vereiste skills |
| publishedAt | string? | Publicatiedatum (ISO) |
| daysOpen | number? | Dagen open |
| confidence | number? | AI confidence 0-1 |

### Detail Velden (bij detailLimit > 0)

| Veld | Type | Beschrijving |
|------|------|--------------|
| hasDetails | boolean | Details opgehaald |
| fullDescription | string? | Volledige tekst |
| requirements | string[] | Vereisten |
| responsibilities | string[] | Verantwoordelijkheden |
| benefits | string[] | Voordelen |
| remotePolicy | string? | Remote beleid |
| applicationDeadline | string? | Deadline |

## Implementatie

### Bestanden

- `public/docs.html` - Standalone HTML met inline CSS/JS
- `src/index.ts` - Route voor `/docs`

### Features

- Copy-to-clipboard voor code blocks
- Expand/collapse secties
- Try-it-out met live API calls
- Syntax highlighting (inline)
- Donker thema (Swagger-dark inspired)
