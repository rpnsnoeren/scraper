import { z } from 'zod';

export const LinkedInAdsRequestSchema = z.object({
  accountOwner: z.string().min(1, 'accountOwner is required'),
  country: z.string().length(2).optional(),
  maxAds: z.number().int().min(1).max(50).optional().default(25),
});

export type LinkedInAdsRequest = z.infer<typeof LinkedInAdsRequestSchema>;

export const LinkedInAdTypeEnum = z.enum(['single_image', 'video', 'carousel', 'text', 'document', 'event', 'unknown']);

export type LinkedInAdType = z.infer<typeof LinkedInAdTypeEnum>;

export const LinkedInAdSchema = z.object({
  adId: z.string(),
  advertiserName: z.string(),
  advertiserLogoUrl: z.string().nullable(),
  advertiserLinkedInUrl: z.string().nullable(),
  adType: LinkedInAdTypeEnum,
  text: z.string().nullable(),
  headline: z.string().nullable(),
  imageUrl: z.string().nullable(),
  landingPageUrl: z.string().nullable(),
  paidBy: z.string().nullable(),
});

export type LinkedInAd = z.infer<typeof LinkedInAdSchema>;

export const LinkedInAdsResponseSchema = z.object({
  accountOwner: z.string(),
  country: z.string().nullable(),
  adCount: z.number(),
  totalResults: z.number().nullable(),
  ads: z.array(LinkedInAdSchema),
  cached: z.boolean(),
  scrapedAt: z.string(),
});

export type LinkedInAdsResponse = z.infer<typeof LinkedInAdsResponseSchema>;
