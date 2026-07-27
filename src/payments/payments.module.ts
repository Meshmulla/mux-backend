import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentStatusHistoryService } from './payment-status-history.service';
import { LimitsModule } from '../limits/limits.module';
import { WalletsModule } from '../wallets/wallets.module';
import { RequestContextService } from '../common/request-context/request-context.service';
import { FeatureFlagService } from '../common/feature-flags/feature-flag.service';
import { FeatureFlagGuard } from '../common/feature-flags/feature-flag.guard';

@Module({
  imports: [ConfigModule, LimitsModule, WalletsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentStatusHistoryService,
    RequestContextService,
    FeatureFlagService,
    FeatureFlagGuard,
  ],
})
export class PaymentsModule {}
