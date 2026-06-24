import { WalletRetryService } from './wallet-retry.service';

describe('WalletRetryService', () => {
  const config = {
    get: jest.fn((_key: string, fallback: number) => fallback),
  };
  let service: WalletRetryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WalletRetryService(config as any);
    jest.spyOn(service as any, 'wait').mockResolvedValue(undefined);
  });

  it('retries transient dependency failures with exponential backoff', async () => {
    const transient = Object.assign(new Error('connection reset'), {
      code: 'ECONNRESET',
    });
    const operation = jest
      .fn()
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce('key-material');

    await expect(
      service.execute({ operation: 'key_generation' }, operation),
    ).resolves.toBe('key-material');

    expect(operation).toHaveBeenCalledTimes(3);
    expect((service as any).wait).toHaveBeenNthCalledWith(1, 100);
    expect((service as any).wait).toHaveBeenNthCalledWith(2, 200);
  });

  it('does not retry invalid or non-transient failures', async () => {
    const invalidRequest = Object.assign(new Error('invalid key request'), {
      status: 400,
    });
    const operation = jest.fn().mockRejectedValue(invalidRequest);

    await expect(
      service.execute({ operation: 'key_generation' }, operation),
    ).rejects.toBe(invalidRequest);

    expect(operation).toHaveBeenCalledTimes(1);
    expect((service as any).wait).not.toHaveBeenCalled();
  });
});
