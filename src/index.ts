// src/index.ts
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Orchestrator } from './services/orchestrator';
import { scrapeRoutes } from './routes/scrape';

async function main() {
  const fastify = Fastify({
    logger: true,
  });

  await fastify.register(cors, {
    origin: true,
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
