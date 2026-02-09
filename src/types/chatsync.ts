import { z } from 'zod';

export const ChatSyncRequestSchema = z.object({
  domain: z.string().min(1).refine(
    (val) => /^[a-zA-Z0-9][a-zA-Z0-9-_.]+\.[a-zA-Z]{2,}$/.test(val),
    { message: 'Invalid domain format' }
  ),
  maxPages: z.number().min(1).max(50).optional().default(20),
});

export type ChatSyncRequest = z.infer<typeof ChatSyncRequestSchema>;

export const PageTypeEnum = z.enum([
  'home', 'about', 'service', 'product', 'pricing',
  'contact', 'faq', 'blog', 'team', 'other',
]);

export type PageType = z.infer<typeof PageTypeEnum>;

export const ChatSyncPageSchema = z.object({
  url: z.string(),
  title: z.string(),
  content: z.string(),
  meta_description: z.string().nullable(),
  headings: z.array(z.string()),
  page_type: PageTypeEnum,
  content_hash: z.string(),
  scraped_at: z.string(),
});

export type ChatSyncPage = z.infer<typeof ChatSyncPageSchema>;

export const ChatSyncResponseSchema = z.object({
  domain: z.string(),
  pageCount: z.number(),
  pages: z.array(ChatSyncPageSchema),
  cached: z.boolean(),
  scrapedAt: z.string(),
});

export type ChatSyncResponse = z.infer<typeof ChatSyncResponseSchema>;
