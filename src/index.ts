// src/index.ts
import 'dotenv/config';
import path from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { Orchestrator } from './services/orchestrator';
import { scrapeRoutes } from './routes/scrape';

async function main() {
  const fastify = Fastify({
    logger: true,
  });

  await fastify.register(cors, {
    origin: true,
  });

  // Serve static files (frontend)
  await fastify.register(fastifyStatic, {
    root: path.join(process.cwd(), 'public'),
    prefix: '/',
  });

  // Validate required env vars
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required');
  }

  const orchestrator = new Orchestrator({
    redisUrl: process.env.REDIS_URL,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Register routes
  await scrapeRoutes(fastify, orchestrator);

  // Serve docs page
  fastify.get('/docs', async (request, reply) => {
    return reply.sendFile('docs.html');
  });

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    await orchestrator.close();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  const port = parseInt(process.env.PORT || '3000', 10);

  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server running on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
