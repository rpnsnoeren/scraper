import Anthropic from '@anthropic-ai/sdk';
import { Vacancy } from '../types/vacancy';
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
      .slice(0, 50000);
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
