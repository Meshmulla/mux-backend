import {
  Injectable,
  NotFoundException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookEventEmitterService } from '../webhooks/webhook-event-emitter.service';
import { CreateLimitDto, LimitPeriod } from './dto/create-limit.dto';
import { UpdateLimitDto } from './dto/update-limit.dto';
import { LimitUpdatedEvent } from './events/limit-updated.event';
import { LimitExceededEvent } from './events/limit-exceeded.event';
import { retryWithBackoff } from '../common/utils/retry';
import { MetricsService } from '../metrics/metrics.service';

export const LIMIT_ERROR_CODES = {
  PER_TX_LIMIT_EXCEEDED: 'LIMIT_PER_TX_EXCEEDED',
  DAILY_LIMIT_EXCEEDED: 'LIMIT_DAILY_EXCEEDED',
} as const;

export type LimitErrorCode =
  (typeof LIMIT_ERROR_CODES)[keyof typeof LIMIT_ERROR_CODES];

export class LimitExceededException extends HttpException {
  constructor(
    public readonly errorCode: LimitErrorCode,
    message: string,
  ) {
    super({ errorCode, message }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

@Injectable()
export class LimitsService {
  private readonly logger = new Logger(LimitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly metrics: MetricsService,
  ) {}

  async setLimits(walletId: string, daily: number, perTx: number) {
    const existing = await retryWithBackoff(
      () =>
        this.prisma.walletLimit.findUnique({
          where: { walletId },
        }),
      3,
      100,
      this.logger,
    );

    const result = await retryWithBackoff(
      () =>
        this.prisma.walletLimit.upsert({
          where: { walletId },
          update: { dailyLimit: daily, perTransactionLimit: perTx },
          create: { walletId, dailyLimit: daily, perTransactionLimit: perTx },
        }),
      3,
      100,
      this.logger,
    );

    if (existing) {
      if (existing.dailyLimit !== daily) {
        this.eventEmitter.emit(
          'limit.updated',
          new LimitUpdatedEvent(
            walletId,
            'daily',
            existing.dailyLimit,
            daily,
            new Date(),
          ),
        );
      }
      if (existing.perTransactionLimit !== perTx) {
        this.eventEmitter.emit(
          'limit.updated',
          new LimitUpdatedEvent(
            walletId,
            'perTransaction',
            existing.perTransactionLimit,
            perTx,
            new Date(),
          ),
        );
      }
    } else {
      this.eventEmitter.emit(
        'limit.updated',
        new LimitUpdatedEvent(walletId, 'daily', null, daily, new Date()),
      );
      this.eventEmitter.emit(
        'limit.updated',
        new LimitUpdatedEvent(
          walletId,
          'perTransaction',
          null,
          perTx,
          new Date(),
        ),
      );
    }

    return result;
  }

  async getLimits(walletId: string) {
    return retryWithBackoff(
      () =>
        this.prisma.walletLimit.findUnique({ where: { walletId } }),
      3,
      100,
      this.logger,
    );
  }

  async checkLimits(walletId: string, amount: number): Promise<void> {
    const requestId = this.requestContext.getRequestId();
    const limits = await this.getLimits(walletId);
    if (!limits) {
      this.metrics.incrementLimitChecks('allowed');
      return;
    }

    this.logger.log(
      `Checking limits walletId=${walletId} amount=${amount} requestId=${requestId}`,
    );

    // Enforce per-transaction cap: a cap of 0 blocks all transactions
    if (
      limits.perTransactionLimit >= 0 &&
      amount > limits.perTransactionLimit
    ) {
      this.eventEmitter.emit(
        'limit.exceeded',
        new LimitExceededEvent(
          walletId,
          'perTransaction',
          limits.perTransactionLimit,
          amount,
          new Date(),
        ),
      );
      throw new LimitExceededException(
        LIMIT_ERROR_CODES.PER_TX_LIMIT_EXCEEDED,
        `Per-transaction limit exceeded. Limit: ${limits.perTransactionLimit}`,
      );
    }

    // Enforce daily cap only when a positive daily limit is configured
    if (limits.dailyLimit > 0) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const txns = await retryWithBackoff(
        () =>
          this.prisma.transaction.findMany({
            where: { senderWalletId: walletId, createdAt: { gte: startOfDay } },
            select: { amount: true },
          }),
        3,
        100,
        this.logger,
      );

      const currentDailyTotal = txns.reduce(
        (sum, t) => sum + Number(t.amount),
        0,
      );
      if (currentDailyTotal + amount > limits.dailyLimit) {
        this.metrics.incrementLimitExceeded('daily');
        this.metrics.incrementLimitChecks('denied');
        this.eventEmitter.emit(
          'limit.exceeded',
          new LimitExceededEvent(
            walletId,
            'daily',
            limits.dailyLimit,
            currentDailyTotal + amount,
            new Date(),
          ),
        );
        throw new LimitExceededException(
          LIMIT_ERROR_CODES.DAILY_LIMIT_EXCEEDED,
          `Daily limit exceeded. Limit: ${limits.dailyLimit}, Used: ${currentDailyTotal}`,
        );
      }
    }

    this.metrics.incrementLimitChecks('allowed');
  }

  async removeLimits(walletId: string) {
    const existing = await this.getLimits(walletId);
    if (!existing)
      throw new NotFoundException(`No limits found for wallet ${walletId}`);
    return retryWithBackoff(
      () => this.prisma.walletLimit.delete({ where: { walletId } }),
      3,
      100,
      this.logger,
    );
  }
}
