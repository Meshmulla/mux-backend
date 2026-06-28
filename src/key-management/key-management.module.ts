import { Module } from '@nestjs/common';
import { KeyManagementService } from './key-management.service';
import { KeyManagementController } from './key-management.controller';
import { StellarKeyProvider } from './providers/stellar-key.provider';
import { EncryptionModule } from '../encryption/encryption.module';
import { KeyRotationAuditService } from './key-rotation-audit.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RequestContextService } from '../common/request-context/request-context.service';
import { KeyValidationCacheService } from './key-validation-cache/key-validation-cache.service';

@Module({
  imports: [EncryptionModule, PrismaModule],
  controllers: [KeyManagementController],
  providers: [
    KeyManagementService,
    StellarKeyProvider,
    KeyRotationAuditService,
    RequestContextService,
    KeyValidationCacheService,
  ],
  exports: [KeyManagementService, KeyRotationAuditService, KeyValidationCacheService],
})
export class KeyManagementModule {}
