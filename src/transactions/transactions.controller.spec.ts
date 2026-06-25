import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { TransactionQueryService } from './transaction-query.service';
import { StellarTransactionBuildService } from './stellar-transaction-build.service';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { FeatureFlagGuard } from '../common/feature-flags/feature-flag.guard';
import { FeatureFlagService } from '../common/feature-flags/feature-flag.service';
import { TransactionStatus } from './domain/transaction.model';

const mockTransactionsService = {
  create: jest.fn(),
  updateStatus: jest.fn(),
};

const mockQueryService = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  findByWallet: jest.fn(),
  findByStellarHash: jest.fn(),
};

const allowGuard = { canActivate: () => true };

describe('TransactionsController', () => {
  let controller: TransactionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        { provide: TransactionsService, useValue: mockTransactionsService },
        { provide: TransactionQueryService, useValue: mockQueryService },
        {
          provide: StellarTransactionBuildService,
          useValue: { buildPayment: jest.fn() },
        },
        {
          provide: FeatureFlagService,
          useValue: { isEnabled: jest.fn().mockReturnValue(true) },
        },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue(allowGuard)
      .overrideGuard(RateLimitGuard)
      .useValue(allowGuard)
      .overrideGuard(FeatureFlagGuard)
      .useValue(allowGuard)
      .compile();

    controller = module.get<TransactionsController>(TransactionsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /transactions/wallet/:walletId', () => {
    it('should call queryService.findByWallet with walletId and no pagination', async () => {
      mockQueryService.findByWallet.mockResolvedValue([]);

      await controller.findByWallet('wallet-1', undefined, undefined);

      expect(mockQueryService.findByWallet).toHaveBeenCalledWith('wallet-1', {
        limit: undefined,
        offset: undefined,
      });
    });

    it('should parse and pass limit and offset', async () => {
      mockQueryService.findByWallet.mockResolvedValue([]);

      await controller.findByWallet('wallet-1', '10', '20');

      expect(mockQueryService.findByWallet).toHaveBeenCalledWith('wallet-1', {
        limit: 10,
        offset: 20,
      });
    });

    it('should return the result from the query service', async () => {
      const tx = { id: 'tx-1', status: TransactionStatus.PENDING };
      mockQueryService.findByWallet.mockResolvedValue([tx]);

      const result = await controller.findByWallet(
        'wallet-1',
        undefined,
        undefined,
      );

      expect(result).toEqual([tx]);
    });
  });

  describe('GET /transactions', () => {
    it('should call queryService.findAll with parsed filters', async () => {
      mockQueryService.findAll.mockResolvedValue([]);

      await controller.findAll('wallet-sender', undefined, undefined, '5', '0');

      expect(mockQueryService.findAll).toHaveBeenCalledWith({
        senderWalletId: 'wallet-sender',
        receiverWalletId: undefined,
        status: undefined,
        limit: 5,
        offset: 0,
      });
    });
  });

  describe('GET /transactions/:id', () => {
    it('should delegate to queryService.findOne', async () => {
      const tx = { id: 'tx-1', status: TransactionStatus.PENDING };
      mockQueryService.findOne.mockResolvedValue(tx);

      const result = await controller.findOne('tx-1');

      expect(mockQueryService.findOne).toHaveBeenCalledWith('tx-1');
      expect(result).toEqual(tx);
    });
  });

  describe('GET /transactions/stellar/:hash', () => {
    it('should delegate to queryService.findByStellarHash', async () => {
      const tx = { id: 'tx-1', stellarHash: 'hash-abc' };
      mockQueryService.findByStellarHash.mockResolvedValue(tx);

      const result = await controller.findByStellarHash('hash-abc');

      expect(mockQueryService.findByStellarHash).toHaveBeenCalledWith(
        'hash-abc',
      );
      expect(result).toEqual(tx);
    });
  });

  describe('PATCH /transactions/:id/status', () => {
    it('should delegate to transactionsService.updateStatus', async () => {
      const updated = { id: 'tx-1', status: TransactionStatus.SUBMITTED };
      mockTransactionsService.updateStatus.mockResolvedValue(updated);

      const result = await controller.updateStatus('tx-1', {
        status: TransactionStatus.SUBMITTED,
      });

      expect(mockTransactionsService.updateStatus).toHaveBeenCalledWith(
        'tx-1',
        { status: TransactionStatus.SUBMITTED },
      );
      expect(result).toEqual(updated);
    });
  });
});
