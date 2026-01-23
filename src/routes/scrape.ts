// src/routes/scrape.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Orchestrator } from '../services/orchestrator';
import { ScrapeRequestSchema } from '../types/vacancy';
import { ZodError } from 'zod';

export async function scrapeRoutes(fastify: FastifyInstance, orchestrator: Orchestrator) {
  // Simple API key auth (only for /api/* routes)
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only check auth for API routes
    if (!request.url.startsWith('/api/')) {
      return;
    }

    const apiKey = request.headers['authorization']?.replace('Bearer ', '');
    const expectedKey = process.env.API_KEY;

    if (!expectedKey || apiKey !== expectedKey) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  fastify.post('/api/scrape', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = ScrapeRequestSchema.parse(request.body);
      const result = await orchestrator.scrape(body.domain);
      return result;
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400).send({
          error: 'Invalid request',
          details: error.issues
        });
        return;
      }

      fastify.log.error(error);
      reply.code(500).send({ error: 'Scrape failed' });
    }
  });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok' };
  });
}
