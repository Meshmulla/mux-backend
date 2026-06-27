import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TransactionEnvValidatorService } from './transaction-env-validator.service';

const makeConfigService = (values: Record<string, string | undefined>) => ({
  get: jest.fn((key: string) => values[key]),
});

const ALL_VARS_PRESENT = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/mux_db',
  STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
};

describe('TransactionEnvValidatorService', () => {
  async function buildService(
    envValues: Record<string, string | undefined>,
  ): Promise<TransactionEnvValidatorService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionEnvValidatorService,
        {
          provide: ConfigService,
          useValue: makeConfigService(envValues),
        },
      ],
    }).compile();

    return module.get<TransactionEnvValidatorService>(
      TransactionEnvValidatorService,
    );
  }

  it('should be defined', async () => {
    const service = await buildService(ALL_VARS_PRESENT);
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('does not throw when all required env vars are present', async () => {
      const service = await buildService(ALL_VARS_PRESENT);
      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('throws when DATABASE_URL is missing', async () => {
      const service = await buildService({
        DATABASE_URL: undefined,
        STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
      });

      expect(() => service.onModuleInit()).toThrow(
        'Transactions API is missing required environment variables: DATABASE_URL',
      );
    });

    it('throws when STELLAR_HORIZON_URL is missing', async () => {
      const service = await buildService({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/mux_db',
        STELLAR_HORIZON_URL: undefined,
      });

      expect(() => service.onModuleInit()).toThrow(
        'Transactions API is missing required environment variables: STELLAR_HORIZON_URL',
      );
    });

    it('lists all missing vars in the error message when multiple are absent', async () => {
      const service = await buildService({
        DATABASE_URL: undefined,
        STELLAR_HORIZON_URL: undefined,
      });

      expect(() => service.onModuleInit()).toThrow(
        'DATABASE_URL, STELLAR_HORIZON_URL',
      );
    });

    it('does not throw when called multiple times with valid config', async () => {
      const service = await buildService(ALL_VARS_PRESENT);
      expect(() => {
        service.onModuleInit();
        service.onModuleInit();
      }).not.toThrow();
    });
  });
});
