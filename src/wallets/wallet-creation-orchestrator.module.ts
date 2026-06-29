import { forwardRef, Module } from '@nestjs/common';
import { WalletCreationOrchestrator } from './wallet-creation-orchestrator.service';
import { WalletCreationOrchestratorController } from './wallet-creation-orchestrator.controller';
import { EncryptionModule } from '../encryption/encryption.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletsModule } from './wallets.module';
import { UsersModule } from '../users/users.module';
import { WebhookModule } from '../webhooks/webhook.module';
import { KeyManagementModule } from '../key-management/key-management.module';
import { CacheService } from '../common/cache/cache.service';
import { IdempotencyService } from '../common/idempotency/idempotency.service';

@Module({
  imports: [
    PrismaModule,
    EncryptionModule,
    KeyManagementModule,
    forwardRef(() => WalletsModule),
    UsersModule,
    WebhookModule,
  ],
  controllers: [WalletCreationOrchestratorController],
  providers: [WalletCreationOrchestrator, IdempotencyService, CacheService],
  exports: [WalletCreationOrchestrator],
})
export class WalletCreationOrchestratorModule {}
