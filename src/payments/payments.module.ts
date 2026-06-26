import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { LimitsModule } from '../limits/limits.module';
import { WalletsModule } from '../wallets/wallets.module';
import { LimitsService } from '../limits/limits.service';
import { PAYMENT_LIMITS_PORT } from './ports/payment-limits.port';

@Module({
  imports: [LimitsModule, WalletsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    { provide: PAYMENT_LIMITS_PORT, useExisting: LimitsService },
  ],
})
export class PaymentsModule {}
