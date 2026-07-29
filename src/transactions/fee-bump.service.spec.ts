import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { FeeBumpService } from './fee-bump.service';
import { TransactionStatus } from './domain/transaction.model';

// ---------------------------------------------------------------------------
// Minimal mocks
// ---------------------------------------------------------------------------

// Mock stellar-sdk so tests don't need the actual Stellar package
jest.mock('stellar-sdk', () => {
  const originalModule = jest.requireActual('stellar-sdk');

  const MockTransaction = jest.fn().mockImplementation((xdr: string) => {
    if (xdr === 'BAD_XDR') throw new Error('invalid XDR');
    return { source: 'GSOURCE...' };
  });

  const MockKeypair = {
    fromSecret: jest.fn().mockReturnValue({
      publicKey: jest.fn().mockReturnValue('GFEE_SOURCE_PUBLIC_KEY'),
      secret: jest.fn().mockReturnValue('SECRET'),
    }),
  };

  const buildFeeBumpTransaction = jest.fn().mockReturnValue({
    sign: jest.fn(),
    toEnvelope: jest.fn().mockReturnValue({
      toXDR: jest.fn().mockReturnValue('BASE64_FEE_BUMP_XDR'),
    }),
  });

  const MockTransactionBuilder = {
    buildFeeBumpTransaction,
  };

  return {
    ...originalModule,
    Transaction: MockTransaction,
    Keypair: MockKeypair,
    TransactionBuilder: MockTransactionBuilder,
    Networks: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015' },
    BASE_FEE: '100',
    Server: jest.fn().mockImplementation(() => ({})),
  };
});

// Mock the request-id-aware axios factory used by FeeBumpService
jest.mock('../common/http/request-id-axios', () => ({
  createRequestIdAwareAxios: jest.fn().mockReturnValue({
    post: jest.fn(),
  }),
}));

import { createRequestIdAwareAxios } from '../common/http/request-id-axios';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(overrides: {
  horizonPost?: jest.Mock;
  getDecryptedPrivateKey?: jest.Mock;
  updateStatus?: jest.Mock;
}) {
  const mockHttp = (createRequestIdAwareAxios as jest.Mock)();
  if (overrides.horizonPost) {
    mockHttp.post = overrides.horizonPost;
  }

  const mockWalletsService = {
    getDecryptedPrivateKey:
      overrides.getDecryptedPrivateKey ??
      jest.fn().mockResolvedValue('STELLAR_SECRET'),
  };

  const mockTransactionsService = {
    updateStatus:
      overrides.updateStatus ?? jest.fn().mockResolvedValue(undefined),
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string, defaultValue: string) => {
      return defaultValue;
    }),
  };

  const service = new FeeBumpService(
    mockConfigService as any,
    mockWalletsService as any,
    mockTransactionsService as any,
  );

  // Inject the mock http directly
  (service as any).http = mockHttp;

  return { service, mockHttp, mockWalletsService, mockTransactionsService };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeeBumpService', () => {
  const VALID_DTO = {
    innerTransactionXdr: 'VALID_XDR',
    feeSourcePublicKey: 'GFEE_SOURCE_PUBLIC_KEY',
    feeSourceWalletId: 'wallet-fee-1',
    transactionId: 'tx-1',
    network: 'TESTNET' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Success path
  // -------------------------------------------------------------------------
  describe('submitFeeBump – success', () => {
    it('builds, signs, and submits the fee-bump XDR, returning the result', async () => {
      const mockPost = jest.fn().mockResolvedValue({
        data: {
          hash: 'abc123hash',
          fee_charged: '1000',
          successful: true,
          ledger: 12345,
        },
        status: 200,
      });

      const { service, mockTransactionsService } = makeService({
        horizonPost: mockPost,
      });

      const result = await service.submitFeeBump(VALID_DTO);

      expect(result.stellarHash).toBe('abc123hash');
      expect(result.feeCharged).toBe('1000');
      expect(result.transactionId).toBe('tx-1');
      expect(result.status).toBe(TransactionStatus.CONFIRMED);

      // Status should be persisted on the internal transaction
      expect(mockTransactionsService.updateStatus).toHaveBeenCalledWith(
        'tx-1',
        expect.objectContaining({ stellarHash: 'abc123hash' }),
      );
    });

    it('works without a transactionId (does not call updateStatus)', async () => {
      const mockPost = jest.fn().mockResolvedValue({
        data: { hash: 'xyz789', successful: true },
        status: 200,
      });

      const { service, mockTransactionsService } = makeService({
        horizonPost: mockPost,
      });

      await service.submitFeeBump({ ...VALID_DTO, transactionId: undefined });

      expect(mockTransactionsService.updateStatus).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Failure paths
  // -------------------------------------------------------------------------
  describe('submitFeeBump – validation failures', () => {
    it('throws BadRequestException for invalid inner XDR', async () => {
      const { service } = makeService({});

      await expect(
        service.submitFeeBump({ ...VALID_DTO, innerTransactionXdr: 'BAD_XDR' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when feeSourcePublicKey does not match wallet key', async () => {
      const { service } = makeService({});

      await expect(
        service.submitFeeBump({
          ...VALID_DTO,
          feeSourcePublicKey: 'GWRONG_KEY',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('re-throws non-NotFoundException errors from getDecryptedPrivateKey', async () => {
      const { service } = makeService({
        getDecryptedPrivateKey: jest
          .fn()
          .mockRejectedValue(new Error('vault offline')),
      });

      await expect(service.submitFeeBump(VALID_DTO)).rejects.toThrow(
        'vault offline',
      );
    });
  });

  describe('submitFeeBump – Horizon rejection (4xx)', () => {
    it('throws BadRequestException and persists FAILED status', async () => {
      const { AxiosError } = jest.requireActual('axios');
      const axiosErr = Object.assign(new Error('Bad request'), {
        response: {
          status: 400,
          data: { result_code: 'tx_bad_seq' },
        },
        isAxiosError: true,
      });

      const mockPost = jest.fn().mockRejectedValue(axiosErr);
      const { service, mockTransactionsService } = makeService({
        horizonPost: mockPost,
      });

      await expect(service.submitFeeBump(VALID_DTO)).rejects.toThrow(
        BadRequestException,
      );

      expect(mockTransactionsService.updateStatus).toHaveBeenCalledWith(
        'tx-1',
        expect.objectContaining({ status: TransactionStatus.FAILED }),
      );
    });
  });

  describe('submitFeeBump – Horizon network error', () => {
    it('throws ServiceUnavailableException when Horizon is unreachable', async () => {
      const networkErr = Object.assign(new Error('ECONNREFUSED'), {
        response: undefined,
        isAxiosError: true,
      });

      const mockPost = jest.fn().mockRejectedValue(networkErr);
      const { service } = makeService({ horizonPost: mockPost });

      await expect(service.submitFeeBump(VALID_DTO)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
