import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import { customerReviewsRoutes } from '../../routes/customer-reviews';
import { CustomerReviewsOrchestrator } from '../customer-reviews-orchestrator';

describe('Customer Reviews Integration', () => {
  const fastify = Fastify();
  const mockScrape = vi.fn();

  const mockOrchestrator = {
    scrape: mockScrape,
  } as unknown as CustomerReviewsOrchestrator;

  beforeAll(async () => {
    await customerReviewsRoutes(fastify, mockOrchestrator);
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should return 400 for missing businessName', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/customer-reviews',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Invalid request');
    expect(body.details).toBeDefined();
  });

  it('should return 400 for empty businessName', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/customer-reviews',
      payload: { businessName: '' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Invalid request');
    expect(body.details).toBeDefined();
  });

  it('should call orchestrator with correct params', async () => {
    const mockResult = {
      businessName: 'Acme BV',
      domain: 'acme.nl',
      platforms: [],
      cached: false,
      scrapedAt: new Date().toISOString(),
    };
    mockScrape.mockResolvedValueOnce(mockResult);

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/customer-reviews',
      payload: { businessName: 'Acme BV', domain: 'acme.nl' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockScrape).toHaveBeenCalledWith('Acme BV', 'acme.nl');
    const body = JSON.parse(response.body);
    expect(body.businessName).toBe('Acme BV');
    expect(body.platforms).toEqual([]);
  });

  it('should handle orchestrator errors gracefully', async () => {
    mockScrape.mockRejectedValueOnce(new Error('Scrape failed'));

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/customer-reviews',
      payload: { businessName: 'Failing BV' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Customer reviews scrape failed');
  });
});
