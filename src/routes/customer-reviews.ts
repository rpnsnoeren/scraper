import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CustomerReviewsOrchestrator } from '../services/customer-reviews-orchestrator';
import { CustomerReviewsRequestSchema } from '../types/customer-reviews';
import { ZodError } from 'zod';

export async function customerReviewsRoutes(fastify: FastifyInstance, orchestrator: CustomerReviewsOrchestrator) {
  fastify.post('/api/customer-reviews', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = CustomerReviewsRequestSchema.parse(request.body);
      const result = await orchestrator.scrape(body.businessName, body.domain);
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
      reply.code(500).send({ error: 'Customer reviews scrape failed' });
    }
  });
}
