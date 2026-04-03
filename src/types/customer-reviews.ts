import { z } from 'zod';

export const CustomerReviewsRequestSchema = z.object({
  businessName: z.string().min(1, 'Bedrijfsnaam is verplicht'),
  domain: z.string().optional(),
});

export type CustomerReviewsRequest = z.infer<typeof CustomerReviewsRequestSchema>;

export const ReviewSchema = z.object({
  author: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  text: z.string(),
  date: z.string().optional(),
});

export type Review = z.infer<typeof ReviewSchema>;

export const PlatformReviewsSchema = z.object({
  platform: z.string(),
  url: z.string(),
  averageRating: z.number().min(0).max(5).optional(),
  totalReviews: z.number().optional(),
  reviews: z.array(ReviewSchema),
});

export type PlatformReviews = z.infer<typeof PlatformReviewsSchema>;

export const CustomerReviewsResponseSchema = z.object({
  businessName: z.string(),
  domain: z.string().optional(),
  platforms: z.array(PlatformReviewsSchema),
  cached: z.boolean(),
  scrapedAt: z.string(),
});

export type CustomerReviewsResponse = z.infer<typeof CustomerReviewsResponseSchema>;
