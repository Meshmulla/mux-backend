import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BalanceIndexerService } from './balance-indexer.service';
import { BalanceIndexerController } from './balance-indexer.controller';
import { StellarHorizonService } from './stellar-horizon.service';
import { WebhookModule } from '../webhooks/webhook.module';
import { RequestContextService } from '../common/request-context/request-context.service';
import { BalanceIndexerMetricsService } from './balance-indexer-metrics.service';

@Module({
  imports: [WebhookModule],
  controllers: [BalanceIndexerController],
  providers: [
    BalanceIndexerService,
    StellarHorizonService,
    RequestContextService,
    BalanceIndexerMetricsService,
  ],
  exports: [
    BalanceIndexerService,
    BalanceIndexerMetricsService,
  ],
})
export class BalanceIndexerModule {}
