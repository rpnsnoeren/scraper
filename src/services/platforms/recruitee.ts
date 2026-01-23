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
      skills: [],
      seniority: null,
      department: offer.department?.name ?? null,
      publishedAt,
      daysOpen,
      scrapedAt: now,
      confidence: 1,
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
