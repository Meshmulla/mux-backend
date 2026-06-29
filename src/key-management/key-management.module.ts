import { Module } from '@nestjs/common';
import { KeyManagementService } from './key-management.service';
import { KeyManagementController } from './key-management.controller';
import { StellarKeyProvider } from './providers/stellar-key.provider';
import { EncryptionModule } from '../encryption/encryption.module';
import { KeyRotationAuditService } from './key-rotation-audit.service';
import { PrismaModule } from '../prisma/prisma.module';
import { FeatureFlagService } from '../common/feature-flags/feature-flag.service';
import { FeatureFlagGuard } from '../common/feature-flags/feature-flag.guard';

@Module({
  imports: [EncryptionModule, PrismaModule],
  controllers: [KeyManagementController],
  providers: [
    KeyManagementService,
    StellarKeyProvider,
    KeyRotationAuditService,
    FeatureFlagService,
    FeatureFlagGuard,
  ],
  exports: [KeyManagementService, KeyRotationAuditService],
})
export class KeyManagementModule {}
