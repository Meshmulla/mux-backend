import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
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
import { RequestContextService } from '../common/request-context/request-context.service';

// Only PENDING payments can be transitioned; terminal states are immutable.
const ALLOWED_TRANSITIONS: Record<string, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.CONFIRMED, PaymentStatus.FAILED],
  [PaymentStatus.CONFIRMED]: [],
  [PaymentStatus.FAILED]: [],
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limitsService: LimitsService,
    private readonly walletsService: WalletsService,
    private readonly requestContext: RequestContextService,
  ) {}

  async create(createPaymentDto: CreatePaymentDto) {
    const requestId = this.requestContext.getRequestId();
    const {
      walletId,
      receiverWalletId,
      fromId,
      toId,
      amount,
      currency,
      description,
    } = createPaymentDto;

    this.logger.log(
      `Creating payment walletId=${walletId} amount=${amount} requestId=${requestId}`,
    );

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

    this.logger.log(
      `Payment created id=${payment.id} requestId=${requestId}`,
    );

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
    const requestId = this.requestContext.getRequestId();
    const paymentId = parseInt(id, 10);

    this.logger.log(
      `Updating payment id=${paymentId} requestId=${requestId}`,
    );

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

    return this.prisma.payment.update({
      where: { id: paymentId },
      data: updatePaymentDto,
    });
  }

  remove(id: string) {
    return `This action removes payment ${id}`;
  }
}
