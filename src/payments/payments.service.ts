import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PrismaService } from '../prisma/prisma.service';
import { LimitsService } from '../limits/limits.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletStatus } from '../wallets/domain/wallet.model';
import { PaymentStatus } from './entities/payment.entity';
import { PaginationDto, PaginatedResponse } from '../common/dto/pagination.dto';
import { PaymentsFilterDto } from './dto/payments-filter.dto';
import { WebhookEventEmitterService } from '../webhooks/webhook-event-emitter.service';

// Only PENDING payments can be transitioned; terminal states are immutable.
const ALLOWED_TRANSITIONS: Record<string, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.CONFIRMED, PaymentStatus.FAILED],
  [PaymentStatus.CONFIRMED]: [],
  [PaymentStatus.FAILED]: [],
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limitsService: LimitsService,
    private readonly walletsService: WalletsService,
    private readonly webhookEventEmitter: WebhookEventEmitterService,
  ) {}

  async create(createPaymentDto: CreatePaymentDto) {
    const {
      walletId,
      receiverWalletId,
      fromId,
      toId,
      amount,
      currency,
      description,
    } = createPaymentDto;

    const senderWallet = await this.walletsService.findWalletById(walletId);
    if (senderWallet.status !== WalletStatus.ACTIVE) {
      throw new BadRequestException(
        `Sender wallet is not active (status: ${senderWallet.status})`,
      );
    }

    await this.walletsService.findWalletById(receiverWalletId);
    await this.limitsService.checkLimits(walletId, amount);

    const payment = await this.prisma.payment.create({
      data: {
        fromId,
        toId,
        amount,
        currency,
        description,
        userId: fromId,
        status: PaymentStatus.PENDING,
      },
    });

    await this.webhookEventEmitter.emitPaymentCreated({
      paymentId: payment.id,
      walletId,
      receiverWalletId,
      amount,
      currency,
      status: payment.status,
    });

    return payment;
  }

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
    const paymentId = parseInt(id, 10);
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

    if (updatePaymentDto.status !== undefined) {
      await this.webhookEventEmitter.emitPaymentStatusUpdated({
        paymentId: updatedPayment.id,
        walletId: String(updatedPayment.fromId),
        previousStatus: payment.status,
        status: updatedPayment.status,
      });
    }

    return updatedPayment;
  }

  remove(id: string) {
    return `This action removes payment ${id}`;
  }
}
