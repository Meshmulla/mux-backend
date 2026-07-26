import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionStatus } from './domain/transaction.model';
import { Transaction as TransactionEntity } from './entities/transaction.entity';
import { CacheService } from '../common/cache/cache.service';

export interface TransactionFilters {
  senderWalletId?: string;
  receiverWalletId?: string;
  status?: TransactionStatus;
  memo?: string;
  limit?: number;
  offset?: number;
}

export interface TransactionPagination {
  limit?: number;
  offset?: number;
}

@Injectable()
export class TransactionQueryService {
  private readonly logger = new Logger(TransactionQueryService.name);
  private readonly TRANSACTION_CACHE_TTL = 300000; // 5 minutes
  static readonly CACHE_KEY_PREFIX = 'transaction';

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async findAll(filters?: TransactionFilters): Promise<TransactionEntity[]> {
    const where: any = {};

    if (filters?.senderWalletId) {
      where.senderWalletId = filters.senderWalletId;
    }

    if (filters?.receiverWalletId) {
      where.receiverWalletId = filters.receiverWalletId;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.memo) {
      where.memo = { contains: filters.memo, mode: 'insensitive' };
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters?.limit,
      skip: filters?.offset,
    });

    return transactions.map((t) => this.mapPrismaToEntity(t));
  }

  async findOne(id: string): Promise<TransactionEntity> {
    const cacheKey = `${TransactionQueryService.CACHE_KEY_PREFIX}:${id}`;

    const cached = this.cache.get<TransactionEntity>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for transaction ${id}`);
      return cached;
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction ${id} not found`);
    }

    const entity = this.mapPrismaToEntity(transaction);
    this.cache.set(cacheKey, entity, this.TRANSACTION_CACHE_TTL);

    return entity;
  }

  async findByWallet(
    walletId: string,
    pagination?: TransactionPagination,
  ): Promise<TransactionEntity[]> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} not found`);
    }

    const transactions = await this.prisma.transaction.findMany({
      where: {
        OR: [{ senderWalletId: walletId }, { receiverWalletId: walletId }],
      },
      orderBy: { createdAt: 'desc' },
      take: pagination?.limit,
      skip: pagination?.offset,
    });

    return transactions.map((t) => this.mapPrismaToEntity(t));
  }

  async findByStellarHash(hash: string): Promise<TransactionEntity | null> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { stellarHash: hash },
    });

    return transaction ? this.mapPrismaToEntity(transaction) : null;
  }

  /**
   * Find transactions stuck in PENDING status for longer than the specified threshold.
   * Useful for admin monitoring and recovery operations.
   * Returns paginated results, sorted by createdAt ascending (oldest first).
   */
  async findStuckPendingTransactions(
    thresholdMinutes: number = 60,
    limit: number = 100,
    offset: number = 0,
  ): Promise<{ data: TransactionEntity[]; total: number }> {
    const thresholdDate = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          status: TransactionStatus.PENDING,
          createdAt: { lt: thresholdDate },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.transaction.count({
        where: {
          status: TransactionStatus.PENDING,
          createdAt: { lt: thresholdDate },
        },
      }),
    ]);

    return {
      data: transactions.map((t) => this.mapPrismaToEntity(t)),
      total,
    };
  }

  invalidateCache(id: string): void {
    this.cache.delete(`${TransactionQueryService.CACHE_KEY_PREFIX}:${id}`);
  }

  private mapPrismaToEntity(prismaTransaction: any): TransactionEntity {
    return {
      id: prismaTransaction.id,
      amount: prismaTransaction.amount,
      assetType: prismaTransaction.assetType,
      assetCode: prismaTransaction.assetCode,
      assetIssuer: prismaTransaction.assetIssuer,
      senderWalletId: prismaTransaction.senderWalletId,
      receiverWalletId: prismaTransaction.receiverWalletId,
      memo: prismaTransaction.memo,
      status: prismaTransaction.status as TransactionStatus,
      stellarHash: prismaTransaction.stellarHash,
      stellarLedger: prismaTransaction.stellarLedger,
      stellarFee: prismaTransaction.stellarFee,
      statusChangedAt: prismaTransaction.statusChangedAt,
      statusReason: prismaTransaction.statusReason,
      submittedAt: prismaTransaction.submittedAt,
      confirmedAt: prismaTransaction.confirmedAt,
      failedAt: prismaTransaction.failedAt,
      metadata: prismaTransaction.metadata,
      idempotencyKey: prismaTransaction.idempotencyKey,
      createdAt: prismaTransaction.createdAt,
      updatedAt: prismaTransaction.updatedAt,
    };
  }
}
