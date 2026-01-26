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
  // Detail fields (only populated when detail scraping is enabled)
  hasDetails: z.boolean().optional(),
  fullDescription: z.string().nullable().optional(),
  requirements: z.array(z.string()).optional(),
  responsibilities: z.array(z.string()).optional(),
  benefits: z.array(z.string()).optional(),
  education: z.string().nullable().optional(),
  experience: z.string().nullable().optional(),
  workHours: z.string().nullable().optional(),
  applicationDeadline: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  remotePolicy: z.enum(['onsite', 'hybrid', 'remote']).nullable().optional(),
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
  detailLimit: z.number().min(0).max(20).optional().default(0),
});

export type ScrapeRequest = z.infer<typeof ScrapeRequestSchema>;
