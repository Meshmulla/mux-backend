import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { PAYMENT_LIMITS_PORT } from './ports/payment-limits.port';
import { WalletStatus } from '../wallets/domain/wallet.model';
import { PaymentStatus } from './entities/payment.entity';

const ACTIVE_WALLET = { id: 'wallet-uuid-sender', status: WalletStatus.ACTIVE };
const RECEIVER_WALLET = {
  id: 'wallet-uuid-receiver',
  status: WalletStatus.ACTIVE,
};

const BASE_DTO = {
  walletId: 'wallet-uuid-sender',
  receiverWalletId: 'wallet-uuid-receiver',
  fromId: 1,
  toId: 2,
  amount: 100,
  currency: 'USD',
  description: 'Test payment',
};

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
  let paymentLimitsPort: any;
  let walletsService: any;

  beforeEach(async () => {
    prisma = {
      payment: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };
    paymentLimitsPort = { checkLimits: jest.fn() };
    walletsService = { findWalletById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PAYMENT_LIMITS_PORT, useValue: paymentLimitsPort },
        { provide: WalletsService, useValue: walletsService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create payment when sender wallet is ACTIVE and limits pass', async () => {
      walletsService.findWalletById
        .mockResolvedValueOnce(ACTIVE_WALLET)
        .mockResolvedValueOnce(RECEIVER_WALLET);
      paymentLimitsPort.checkLimits.mockResolvedValue(undefined);
      prisma.payment.create.mockResolvedValue({
        id: 1,
        ...BASE_DTO,
        status: PaymentStatus.PENDING,
      });

      const result = await service.create(BASE_DTO);

      expect(walletsService.findWalletById).toHaveBeenCalledWith(
        BASE_DTO.walletId,
      );
      expect(walletsService.findWalletById).toHaveBeenCalledWith(
        BASE_DTO.receiverWalletId,
      );
      expect(paymentLimitsPort.checkLimits).toHaveBeenCalledWith(
        BASE_DTO.walletId,
        BASE_DTO.amount,
      );
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: {
          fromId: BASE_DTO.fromId,
          toId: BASE_DTO.toId,
          amount: BASE_DTO.amount,
          currency: BASE_DTO.currency,
          description: BASE_DTO.description,
          userId: BASE_DTO.fromId,
          status: PaymentStatus.PENDING,
        },
      });
      expect(result.status).toBe(PaymentStatus.PENDING);
    });

    it('should throw BadRequestException when sender wallet is not ACTIVE', async () => {
      walletsService.findWalletById.mockResolvedValue({
        ...ACTIVE_WALLET,
        status: WalletStatus.SUSPENDED,
      });

      await expect(service.create(BASE_DTO)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update payment status', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 1,
        status: PaymentStatus.PENDING,
      });
      prisma.payment.update.mockResolvedValue({
        id: 1,
        status: PaymentStatus.CONFIRMED,
      });

      const result = await service.update('1', {
        status: PaymentStatus.CONFIRMED,
      });

      expect(result.status).toBe(PaymentStatus.CONFIRMED);
    });

    it('should throw NotFoundException when payment does not exist', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      await expect(
        service.update('99', { status: PaymentStatus.CONFIRMED }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid status transition', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 1,
        status: PaymentStatus.CONFIRMED,
      });

      await expect(
        service.update('1', { status: PaymentStatus.PENDING }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('business logic validation', () => {
    it('should check limits when creating payment', async () => {
      walletsService.findWalletById
        .mockResolvedValueOnce(ACTIVE_WALLET)
        .mockResolvedValueOnce(RECEIVER_WALLET);
      paymentLimitsPort.checkLimits.mockResolvedValue(undefined);
      prisma.payment.create.mockResolvedValue({
        id: 1,
        ...BASE_DTO,
        status: PaymentStatus.PENDING,
      });

      await service.create(BASE_DTO);

      expect(paymentLimitsPort.checkLimits).toHaveBeenCalledWith(
        BASE_DTO.walletId,
        BASE_DTO.amount,
      );
    });
  });

  describe('pagination', () => {
    it('should return paginated results with defaults', async () => {
      const payments = [{ id: 1 }, { id: 2 }];
      prisma.payment.findMany.mockResolvedValue(payments);
      prisma.payment.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, limit: 20 }, {});

      expect(result.data).toEqual(payments);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
      });
    });

    it('should apply correct skip offset for page 2', async () => {
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.count.mockResolvedValue(100);

      await service.findAll({ page: 2, limit: 20 }, {});

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 20,
        take: 20,
      });
    });
  });

  describe('filtering', () => {
    it('should apply status filter when provided', async () => {
      const payments = [{ id: 1, status: PaymentStatus.PENDING }];
      prisma.payment.findMany.mockResolvedValue(payments);
      prisma.payment.count.mockResolvedValue(1);

      await service.findAll(
        { page: 1, limit: 20 },
        { status: PaymentStatus.PENDING },
      );

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: { status: PaymentStatus.PENDING },
        skip: 0,
        take: 20,
      });
      expect(prisma.payment.count).toHaveBeenCalledWith({
        where: { status: PaymentStatus.PENDING },
      });
    });

    it('should not apply filter when not provided', async () => {
      const payments = [{ id: 1 }];
      prisma.payment.findMany.mockResolvedValue(payments);
      prisma.payment.count.mockResolvedValue(100);

      await service.findAll({ page: 1, limit: 20 }, {});

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
      });
    });
  });
});
