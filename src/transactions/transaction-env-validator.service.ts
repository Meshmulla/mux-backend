import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const REQUIRED_VARS: ReadonlyArray<string> = [
  'DATABASE_URL',
  'STELLAR_HORIZON_URL',
];

@Injectable()
export class TransactionEnvValidatorService implements OnModuleInit {
  private readonly logger = new Logger(TransactionEnvValidatorService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const missing: string[] = [];

    for (const key of REQUIRED_VARS) {
      const value = this.configService.get<string>(key);
      if (!value) {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      const msg = `Transactions API is missing required environment variables: ${missing.join(', ')}`;
      this.logger.error(msg);
      throw new Error(msg);
    }

    this.logger.log('Transactions API environment validated successfully');
  }
}
