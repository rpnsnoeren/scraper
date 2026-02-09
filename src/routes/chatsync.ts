import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ChatSyncOrchestrator } from '../services/chatsync-orchestrator';
import { ChatSyncRequestSchema } from '../types/chatsync';
import { ZodError } from 'zod';

export async function chatsyncRoutes(fastify: FastifyInstance, orchestrator: ChatSyncOrchestrator) {
  fastify.post('/api/chatsync', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = ChatSyncRequestSchema.parse(request.body);
      const result = await orchestrator.scrape(body.domain, body.maxPages);
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
      reply.code(500).send({ error: 'ChatSync scrape failed' });
    }
  });
}
