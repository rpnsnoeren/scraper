import Anthropic from '@anthropic-ai/sdk';
import { Vacancy } from '../types/vacancy';
import { createVacancyId } from '../utils/url';
import { z } from 'zod';

const AIVacancySchema = z.object({
  title: z.string(),
  url: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  description: z.string().default(''),
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
      .slice(0, 80000);
  }

  buildPrompt(html: string, url: string): string {
    const cleanedHtml = this.cleanHtml(html);
    const domain = new URL(url).hostname;

    return `Je bent een expert in het extraheren van vacatures van career pagina's. Analyseer de tekst van ${domain} en vind ALLE vacatures.

BELANGRIJK:
- Zoek naar ALLE vacatures/jobs die je kunt vinden, niet alleen de eerste paar
- Elke unieke functietitel is een vacature
- Let op lijsten, kaarten, of herhalende patronen die vacatures aangeven

Voor elke vacature, extraheer (gebruik null als niet beschikbaar):
- title: functietitel (VERPLICHT)
- url: link naar de vacature (kan relatief zijn zoals "/jobs/123")
- location: locatie (stad, land, of "Remote")
- description: korte beschrijving (max 300 tekens)
- salary_min/salary_max/salary_currency/salary_period: salaris info
- type: "fulltime", "parttime", "contract", of "internship"
- skills: array van gevraagde skills (bijv. ["Python", "React"])
- seniority: "junior", "medior", "senior", of "lead"
- department: afdeling
- published_date: datum in ISO format (YYYY-MM-DD)

Antwoord ALLEEN met valid JSON:
{
  "vacancies": [{"title": "...", ...}],
  "confidence": 0.0-1.0
}

Tekst:
${cleanedHtml}`;
  }

  async extract(html: string, url: string): Promise<{ vacancies: Vacancy[]; confidence: number }> {
    const prompt = this.buildPrompt(html, url);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Claude response');
    }

    const parsed = AIResponseSchema.parse(JSON.parse(jsonMatch[0]));
    const now = new Date().toISOString();

    const vacancies: Vacancy[] = parsed.vacancies.map((v) => {
      const vacancyUrl = v.url ? (v.url.startsWith('http') ? v.url : new URL(v.url, url).href) : url;
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
