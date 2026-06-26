import { Module } from '@nestjs/common';
import { LimitsService } from './limits.service';
import { LimitsController } from './limits.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheService } from '../common/cache/cache.service';

@Module({
  imports: [PrismaModule],
  controllers: [LimitsController],
  providers: [LimitsService, CacheService],
  exports: [LimitsService],
})
export class LimitsModule {}
