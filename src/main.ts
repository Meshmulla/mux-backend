import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Let Nest call onModuleDestroy/beforeApplicationShutdown on SIGTERM/SIGINT
  // so in-flight requests can finish and connections (Prisma, etc.) close cleanly.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Application listening on port ${port}`);
}
bootstrap();
