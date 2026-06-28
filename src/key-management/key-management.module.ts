import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { KeyManagementService } from './key-management.service';
import { KeyManagementController } from './key-management.controller';
import { StellarKeyProvider } from './providers/stellar-key.provider';
import { EncryptionModule } from '../encryption/encryption.module';
import { KeyRotationAuditService } from './key-rotation-audit.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [EncryptionModule, PrismaModule, EventEmitterModule.forRoot()],
  controllers: [KeyManagementController],
  providers: [
    KeyManagementService,
    StellarKeyProvider,
    KeyRotationAuditService,
  ],
  exports: [KeyManagementService, KeyRotationAuditService],
})
export class KeyManagementModule {}
