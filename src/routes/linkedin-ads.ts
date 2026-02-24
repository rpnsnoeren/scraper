import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { LinkedInAdsOrchestrator } from '../services/linkedin-ads-orchestrator';
import { LinkedInAdsRequestSchema } from '../types/linkedin-ads';
import { ZodError } from 'zod';

export async function linkedInAdsRoutes(fastify: FastifyInstance, orchestrator: LinkedInAdsOrchestrator) {
  fastify.post('/api/linkedin-ads', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = LinkedInAdsRequestSchema.parse(request.body);
      const result = await orchestrator.scrape(body.accountOwner, body.maxAds);
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
      reply.code(500).send({ error: 'LinkedIn Ads scrape failed' });
    }
  });
}
