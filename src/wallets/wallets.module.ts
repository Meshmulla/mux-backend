import { forwardRef, Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { EncryptionModule } from '../encryption/encryption.module';
import { EncryptionService } from 'src/encryption/encryption.service';
import { ApiKeyModule } from '../api-keys/api-key.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { KeyManagementModule } from '../key-management/key-management.module';
import { WalletCreationOrchestratorModule } from './wallet-creation-orchestrator.module';

@Module({
  imports: [
    EncryptionModule,
    ApiKeyModule,
    RateLimitModule,
    KeyManagementModule,
    forwardRef(() => WalletCreationOrchestratorModule),
  ],
  controllers: [WalletsController],
  providers: [WalletsService, EncryptionService],
  exports: [WalletsService],
})
export class WalletsModule {}
