import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PrismaService } from '../prisma/prisma.service';
import { LimitsService } from '../limits/limits.service';
import {
  PaginationQuery,
  parsePagination,
  buildPaginatedResponse,
} from '../common/pagination/pagination.util';
import { WalletsService } from '../wallets/wallets.service';
import {
  PAYMENT_LIMITS_PORT,
  PaymentLimitsPort,
} from './ports/payment-limits.port';
import { WalletStatus } from '../wallets/domain/wallet.model';
import { PaymentStatus } from './entities/payment.entity';
import { PaginationDto, PaginatedResponse } from '../common/dto/pagination.dto';
import { PaymentsFilterDto } from './dto/payments-filter.dto';
import { PaymentCreatedEvent } from './events/payment-created.event';
import { PaymentCompletedEvent } from './events/payment-completed.event';
import { PaymentFailedEvent } from './events/payment-failed.event';
import { retryWithBackoff } from '../common/utils/retry';
import { MetricsService } from '../metrics/metrics.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { PaymentMetricsService } from './payment-metrics.service';
import {
  StructuredLogger,
  LogContext,
} from '../common/logging/structured-logger';

// Only PENDING payments can be transitioned; terminal states are immutable.
const ALLOWED_TRANSITIONS: Record<string, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.CONFIRMED, PaymentStatus.FAILED],
  [PaymentStatus.CONFIRMED]: [],
  [PaymentStatus.FAILED]: [],
};

@Injectable()
export class PaymentsService {
  private readonly logger = new StructuredLogger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_LIMITS_PORT)
    private readonly paymentLimitsPort: PaymentLimitsPort,
    private readonly walletsService: WalletsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly metrics: MetricsService,
    private readonly requestContext: RequestContextService,
    private readonly paymentMetrics: PaymentMetricsService,
    private readonly configService: ConfigService,
  ) {}

  async create(createPaymentDto: CreatePaymentDto) {
    const requestId = this.requestContext.getRequestId();
    const start = Date.now();
    const {
      walletId,
      receiverWalletId,
      fromId,
      toId,
      amount,
      currency,
      assetCode,
      description,
      idempotencyKey,
    } = createPaymentDto;

    if (idempotencyKey) {
      const existing = await this.prisma.payment.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        this.logger.logWithContext('Idempotency hit, returning existing payment', {
          requestId,
          entityId: existing.id.toString(),
          entityType: 'payment',
          operation: 'create',
          outcome: 'idempotent',
        });
        this.metrics.incrementPaymentIdempotencyHit();
        this.paymentMetrics.record({
          operation: 'create',
          outcome: 'idempotent',
          durationMs: Date.now() - start,
          currency,
        });
        return existing;
      }
    }

    try {
      const senderWallet = await retryWithBackoff(
        () => this.walletsService.findWalletById(walletId),
        3,
        100,
        this.logger,
      );
      if (senderWallet.status !== WalletStatus.ACTIVE) {
        throw new BadRequestException(
          `Sender wallet is not active (status: ${senderWallet.status})`,
        );
      }

      const blockSelfPayments = this.configService.get<boolean>(
        'BLOCK_SELF_PAYMENTS',
        false,
      );
      if (blockSelfPayments && fromId === toId) {
        throw new BadRequestException(
          'Payments to self are not allowed',
        );
      }

      await retryWithBackoff(
        () => this.walletsService.findWalletById(receiverWalletId),
        3,
        100,
        this.logger,
      );
      await retryWithBackoff(
        () => this.paymentLimitsPort.checkLimits(walletId, amount),
        3,
        100,
        this.logger,
      );

      const payment = await this.prisma.payment.create({
        data: {
          fromId,
          toId,
          amount,
          currency,
          assetCode,
          description,
          userId: fromId,
          status: PaymentStatus.PENDING,
          idempotencyKey: idempotencyKey ?? null,
        },
      });

      this.metrics.incrementPaymentsCreated();
      this.paymentMetrics.record({
        operation: 'create',
        outcome: 'success',
        durationMs: Date.now() - start,
        currency,
      });

      this.eventEmitter.emit(
        'payment.created',
        new PaymentCreatedEvent(
          payment.id,
          payment.amount,
          payment.currency,
          payment.userId,
        ),
      );

      return payment;
    } catch (err) {
      this.paymentMetrics.record({
        operation: 'create',
        outcome: 'failure',
        durationMs: Date.now() - start,
        currency,
        failureReason: err?.constructor?.name ?? 'unknown',
      });
      throw err;
    }
  }

  async findAll(query: PaginationQuery = {}) {
    const { page, limit, skip } = parsePagination(query);

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.count(),
    ]);

    return buildPaginatedResponse(data, total, page, limit);
  async findAll(
    pagination: PaginationDto,
    filters: PaymentsFilterDto,
  ): Promise<PaginatedResponse<any>> {
    const skip = (pagination.page - 1) * pagination.limit;

    const where: any = {};
    if (filters.status) {
      where.status = filters.status;
    }

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: pagination.limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data,
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  findOne(id: string) {
    return this.prisma.payment.findUnique({
      where: { id: parseInt(id, 10) },
    });
  }

  async update(id: string, updatePaymentDto: UpdatePaymentDto) {
    const requestId = this.requestContext.getRequestId();
    const paymentId = parseInt(id, 10);

    this.logger.logWithContext('Updating payment', {
      requestId,
      entityId: paymentId.toString(),
      entityType: 'payment',
      operation: 'update',
    });

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new NotFoundException(`Payment #${paymentId} not found`);
    }

    if (updatePaymentDto.status !== undefined) {
      const allowed = ALLOWED_TRANSITIONS[payment.status] ?? [];
      if (!allowed.includes(updatePaymentDto.status)) {
        throw new BadRequestException(
          `Cannot transition payment from ${payment.status} to ${updatePaymentDto.status}`,
        );
      }
    }

    const updatedPayment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: updatePaymentDto,
    });

    if (updatePaymentDto.status === PaymentStatus.CONFIRMED) {
      this.eventEmitter.emit(
        'payment.completed',
        new PaymentCompletedEvent(
          updatedPayment.id,
          updatedPayment.amount,
          updatedPayment.currency,
          updatedPayment.userId,
        ),
      );
    } else if (updatePaymentDto.status === PaymentStatus.FAILED) {
      this.metrics.incrementPaymentsFailed('user_action');
      this.eventEmitter.emit(
        'payment.failed',
        new PaymentFailedEvent(
          updatedPayment.id,
          updatedPayment.amount,
          updatedPayment.currency,
          updatedPayment.userId,
        ),
      );
    }

    return updatedPayment;
  }

  remove(id: string) {
    return `This action removes payment ${id}`;
  }
}
