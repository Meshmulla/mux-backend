import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/public.decorator';

export interface HealthPayload {
  status: 'ok';
  network: string;
  timestamp: string;
}

@Controller('health')
export class HealthController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  @Public()
  getHealth(): HealthPayload {
    return {
      status: 'ok',
      network: this.configService.get<string>('STELLAR_NETWORK', 'TESTNET'),
      timestamp: new Date().toISOString(),
    };
  }
}
