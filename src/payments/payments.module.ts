import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { LimitsModule } from '../limits/limits.module';
import { WalletsModule } from '../wallets/wallets.module';
import { WebhookModule } from '../webhooks/webhook.module';

@Module({
  imports: [LimitsModule, WalletsModule, WebhookModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
