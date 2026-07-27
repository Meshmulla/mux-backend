import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Guard that validates cron/internal endpoint requests using a shared secret header.
 * The secret must be provided in the X-Cron-Secret header and must match the
 * configured CRON_SECRET environment variable.
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  private readonly logger = new Logger(CronSecretGuard.name);
  private readonly cronSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.cronSecret = this.configService.get<string>('CRON_SECRET', '');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const secretHeader = request.headers['x-cron-secret'] as string;

    if (!this.cronSecret) {
      this.logger.warn(
        'CRON_SECRET not configured; denying all cron requests',
      );
      throw new UnauthorizedException(
        'Cron secret not configured on server',
      );
    }

    if (!secretHeader) {
      this.logger.warn(
        `Cron request from ${request.ip} missing X-Cron-Secret header`,
      );
      throw new UnauthorizedException(
        'X-Cron-Secret header is required',
      );
    }

    if (secretHeader !== this.cronSecret) {
      this.logger.warn(
        `Cron request from ${request.ip} with invalid secret`,
      );
      throw new UnauthorizedException('Invalid cron secret');
    }

    return true;
  }
}
