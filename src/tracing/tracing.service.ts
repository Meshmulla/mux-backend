import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { trace, Tracer } from '@opentelemetry/api';

@Injectable()
export class TracingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TracingService.name);
  private sdk: NodeSDK | null = null;
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const otelEnabled = this.configService.get<string>('OTEL_ENABLED');

    if (otelEnabled !== 'true') {
      this.logger.log('OpenTelemetry tracing is disabled (OTEL_ENABLED is not set to "true")');
      return;
    }

    const endpoint =
      this.configService.get<string>('OTEL_EXPORTER_OTLP_ENDPOINT') ??
      'http://localhost:4318/v1/traces';

    const serviceName =
      this.configService.get<string>('OTEL_SERVICE_NAME') ?? 'mux-backend';

    const serviceVersion =
      this.configService.get<string>('OTEL_SERVICE_VERSION') ?? '1.0.0';

    const exporter = new OTLPTraceExporter({ url: endpoint });

    this.sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_VERSION]: serviceVersion,
      }),
      traceExporter: exporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          // Disable noisy fs instrumentation
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    this.sdk.start();
    this.initialized = true;
    this.logger.log(
      `OpenTelemetry tracing initialized — service="${serviceName}" endpoint="${endpoint}"`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sdk && this.initialized) {
      try {
        await this.sdk.shutdown();
        this.logger.log('OpenTelemetry SDK shut down gracefully');
      } catch (err) {
        this.logger.error('Error shutting down OpenTelemetry SDK', err);
      }
    }
  }

  /**
   * Returns a named tracer for manual span creation.
   * When tracing is disabled this returns a no-op tracer so callers are unaffected.
   */
  getTracer(name: string): Tracer {
    return trace.getTracer(name);
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
