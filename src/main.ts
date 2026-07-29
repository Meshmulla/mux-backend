import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import requestLogger from './common/middleware/request-logging.middleware';
import { validateEnv } from './config/env.validation';

/**
 * Parses the CORS_ALLOWED_ORIGINS env var into an array of allowed origins.
 * Falls back to localhost:3000 for local development.
 *
 * Format: comma-separated list, e.g.
 *   CORS_ALLOWED_ORIGINS=https://app.mux.finance,https://partner.example.com
 */
function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) return ['http://localhost:3000'];
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

async function bootstrap() {
  // Validate all required environment variables before anything else starts.
  validateEnv(process.env);

  const app = await NestFactory.create(AppModule);

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Only allow explicitly listed origins. Credentials (cookies / Authorization
  // headers) are enabled so frontend SDKs can attach API keys via Bearer tokens.
  // Pre-flight OPTIONS responses are cached for 24 hours to reduce round-trips.
  const allowedOrigins = parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS);
  app.enableCors({
    origin: (origin, callback) => {
      // Allow server-to-server calls (no Origin header) and listed origins.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' not allowed`));
      }
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Api-Version'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    credentials: true,
    maxAge: 86400, // 24 h preflight cache
  });

  // ── Security headers ──────────────────────────────────────────────────────
  // Applied to every response. No helmet dependency — set directly to keep the
  // dependency surface small and avoid version-skew issues.
  app.use((_req: any, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    // Prevent response bodies from leaking sensitive data through caching.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

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
