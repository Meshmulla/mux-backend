import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WebhookService } from './webhook.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { WebhookRetryService } from './webhook-retry.service';
import { WebhookSignerService } from './webhook-signer.service';
import { WebhookEventEmitterService } from './webhook-event-emitter.service';
import { WebhookDeliveryQueueWorker } from './webhook-delivery-queue.worker';
import { WebhookController } from './webhook.controller';
import { MetricsService } from '../common/metrics/metrics.service';
import { WebhookConfigService } from './webhook-config.service';
import { CacheService } from '../common/cache/cache.service';

@Module({
  imports: [ConfigModule],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookDispatcherService,
    WebhookDispatchService,
    WebhookRetryService,
    WebhookSignerService,
    WebhookEventEmitterService,
    WebhookDeliveryQueueWorker,
    MetricsService,
    WebhookConfigService,
    CacheService,
  ],
  exports: [WebhookEventEmitterService, WebhookDispatcherService],
})
export class WebhookModule {}
