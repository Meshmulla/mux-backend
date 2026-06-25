import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WebhookService } from './webhook.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookSignerService } from './webhook-signer.service';
import { WebhookEventEmitterService } from './webhook-event-emitter.service';
import { WebhookDeliveryQueueWorker } from './webhook-delivery-queue.worker';
import { WebhookController } from './webhook.controller';
import { CacheService } from '../common/cache/cache.service';
import { FeatureFlagService } from '../common/feature-flags/feature-flag.service';
import { RequestContextService } from '../common/request-context/request-context.service';

@Module({
  imports: [ConfigModule],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookDispatcherService,
    WebhookSignerService,
    WebhookEventEmitterService,
    WebhookDeliveryQueueWorker,
    CacheService,
    FeatureFlagService,
    RequestContextService,
  ],
  exports: [WebhookEventEmitterService, WebhookDispatcherService],
})
export class WebhookModule {}
