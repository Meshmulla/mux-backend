import { Injectable } from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PrismaService } from '../prisma/prisma.service';
import { LimitsService } from '../limits/limits.service';
import {
  PaginationQuery,
  parsePagination,
  buildPaginatedResponse,
} from '../common/pagination/pagination.util';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limitsService: LimitsService,
  ) {}

  async create(createPaymentDto: CreatePaymentDto) {
    const { fromId, toId, amount, currency, description } = createPaymentDto;

    await this.limitsService.checkLimits(fromId, amount);

    return this.prisma.payment.create({
      data: {
        fromId,
        toId,
        amount,
        currency,
        description,
        userId: fromId, // Legacy support: default to sender
        status: 'PENDING',
      },
    });
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
  }

  findOne(id: number) {
    return this.prisma.payment.findUnique({ where: { id } });
  }

  update(id: number, updatePaymentDto: UpdatePaymentDto) {
    return `This action updates a #${id} payment`;
  }

  remove(id: number) {
    return `This action removes a #${id} payment`;
  }
}
