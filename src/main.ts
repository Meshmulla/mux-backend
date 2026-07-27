import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import requestLogger from './common/middleware/request-logging.middleware';

async function bootstrap() {
  // Environment validation is handled by ConfigModule (src/config/config.module.ts)
  // which calls validateEnv() at startup with detailed error messages.

  const app = await NestFactory.create(AppModule);
  // Attach request logging middleware early in the pipeline
  app.use(requestLogger as any);

  // Validate incoming requests for DTOs globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
