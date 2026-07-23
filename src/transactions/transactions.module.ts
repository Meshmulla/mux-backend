import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { TransactionQueryService } from './transaction-query.service';
import { StellarTransactionBuildService } from './stellar-transaction-build.service';
import { HorizonSubmissionService } from './horizon-submission.service';
import { TransactionRetryService } from './transaction-retry.service';
import { TransactionPollingService } from './transaction-polling.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BalanceIndexerModule } from '../balance-indexer/balance-indexer.module';
import { WebhookModule } from '../webhooks/webhook.module';
import { CacheService } from '../common/cache/cache.service';
import { FeatureFlagService } from '../common/feature-flags/feature-flag.service';
import { TransactionMetricsService } from './transaction-metrics.service';
import { TransactionEnvValidatorService } from './transaction-env-validator.service';

@Module({
  imports: [PrismaModule, BalanceIndexerModule, WebhookModule],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    StellarTransactionBuildService,
    CacheService,
    FeatureFlagService,
    TransactionMetricsService,
    TransactionEnvValidatorService,
    TransactionPollingService,
  ],
  exports: [TransactionsService, StellarTransactionBuildService, TransactionPollingService],
})
export class TransactionsModule {}
