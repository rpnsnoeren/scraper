import { z } from 'zod';

export const GoogleAdsRequestSchema = z.object({
  domain: z.string().min(1).refine(
    (val) => /^[a-zA-Z0-9][a-zA-Z0-9-_.]+\.[a-zA-Z]{2,}$/.test(val),
    { message: 'Invalid domain format' }
  ),
  region: z.string().length(2).optional().default('NL'),
});

export type GoogleAdsRequest = z.infer<typeof GoogleAdsRequestSchema>;

export const AdFormatEnum = z.enum(['text', 'image', 'video', 'unknown']);

export type AdFormat = z.infer<typeof AdFormatEnum>;

export const GoogleAdSchema = z.object({
  creativeId: z.string(),
  advertiserId: z.string(),
  advertiserName: z.string(),
  domain: z.string().nullable(),
  format: AdFormatEnum,
  firstShown: z.string().nullable(),
  lastShown: z.string().nullable(),
  daysActive: z.number().nullable(),
  contentUrl: z.string().nullable(),
  impressions: z.object({
    low: z.number().nullable(),
    high: z.number().nullable(),
    platforms: z.array(z.object({
      name: z.string(),
      low: z.number().nullable(),
      high: z.number().nullable(),
    })),
  }).nullable(),
  topic: z.string().nullable(),
  targeting: z.object({
    demographics: z.boolean(),
    geographic: z.boolean(),
    contextual: z.boolean(),
    customerLists: z.boolean(),
  }).nullable(),
});

export type GoogleAd = z.infer<typeof GoogleAdSchema>;

export const GoogleAdsAdvertiserSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string().nullable(),
  verificationStatus: z.enum(['verified', 'unverified', 'unknown']),
  adCountRange: z.object({
    low: z.number().nullable(),
    high: z.number().nullable(),
  }).nullable(),
});

export type GoogleAdsAdvertiser = z.infer<typeof GoogleAdsAdvertiserSchema>;

export const GoogleAdsResponseSchema = z.object({
  domain: z.string(),
  region: z.string(),
  advertiser: GoogleAdsAdvertiserSchema.nullable(),
  adCount: z.number(),
  ads: z.array(GoogleAdSchema),
  cached: z.boolean(),
  scrapedAt: z.string(),
});

export type GoogleAdsResponse = z.infer<typeof GoogleAdsResponseSchema>;
