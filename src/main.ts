import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import requestLogger from './common/middleware/request-logging.middleware';
import { validateEnv } from './config/env.validation';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Validate all required environment variables before anything else starts.
  // This will exit the process with a clear error message if any variable is
  // missing or invalid, preventing silent runtime failures later.
  validateEnv(process.env);

  const app = await NestFactory.create(AppModule);
  // Attach request logging middleware early in the pipeline
  app.use(requestLogger as any);

  // All routes are served under /v1. See docs/API-VERSIONING.md for the
  // versioning strategy and how future breaking changes will be introduced.
  app.setGlobalPrefix('v1');

  // Validate incoming requests for DTOs globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Let Nest call onModuleDestroy/beforeApplicationShutdown on SIGTERM/SIGINT
  // so in-flight requests can finish and connections (Prisma, etc.) close cleanly.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Application listening on port ${port}`);
}

bootstrap();
