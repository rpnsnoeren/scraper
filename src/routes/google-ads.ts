import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { GoogleAdsOrchestrator } from '../services/google-ads-orchestrator';
import { GoogleAdsRequestSchema } from '../types/google-ads';
import { ZodError } from 'zod';

export async function googleAdsRoutes(fastify: FastifyInstance, orchestrator: GoogleAdsOrchestrator) {
  fastify.post('/api/google-ads', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = GoogleAdsRequestSchema.parse(request.body);
      const result = await orchestrator.scrape(body.domain, body.region);
      return result;
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400).send({
          error: 'Invalid request',
          details: error.issues,
        });
        return;
      }

      fastify.log.error(error);
      reply.code(500).send({ error: 'Google Ads scrape failed' });
    }
  });
}
