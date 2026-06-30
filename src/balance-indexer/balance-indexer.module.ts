import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BalanceIndexerService } from './balance-indexer.service';
import { BalanceIndexerController } from './balance-indexer.controller';
import { StellarHorizonService } from './stellar-horizon.service';
import { BalanceRepository } from './balance.repository';
import { BalanceCacheService } from './balance-cache.service';
import { WebhookModule } from '../webhooks/webhook.module';
import { RequestContextService } from '../common/request-context/request-context.service';
import { BalanceIndexerMetricsService } from './balance-indexer-metrics.service';
import { CacheService } from '../common/cache/cache.service';
import { FeatureFlagService } from '../common/feature-flags/feature-flag.service';
import { FeatureFlagGuard } from '../common/feature-flags/feature-flag.guard';

@Module({
  imports: [WebhookModule, ConfigModule],
  controllers: [BalanceIndexerController],
  providers: [
    BalanceIndexerService,
    StellarHorizonService,
    BalanceRepository,
    RequestContextService,
    BalanceIndexerMetricsService,
    CacheService,
    BalanceCacheService,
    FeatureFlagService,
    FeatureFlagGuard,
  ],
  exports: [
    BalanceIndexerService,
    BalanceIndexerMetricsService,
    BalanceCacheService,
  ],
})
export class BalanceIndexerModule {}
