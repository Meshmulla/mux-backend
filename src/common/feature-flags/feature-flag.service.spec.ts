import { ConfigService } from '@nestjs/config';
import { FeatureFlagService } from './feature-flag.service';

describe('FeatureFlagService', () => {
  let service: FeatureFlagService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as any;

    service = new FeatureFlagService(configService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return true when feature flag is enabled', () => {
    jest.spyOn(configService, 'get').mockReturnValue('true');

    const result = service.isEnabled('transactions_api');

    expect(result).toBe(true);
    expect(configService.get).toHaveBeenCalledWith('FEATURE_TRANSACTIONS_API');
  });

  it('should return false when feature flag is disabled', () => {
    jest.spyOn(configService, 'get').mockReturnValue('false');

    const result = service.isEnabled('transactions_api');

    expect(result).toBe(false);
  });

  it('should return false when feature flag is not set', () => {
    jest.spyOn(configService, 'get').mockReturnValue(undefined);

    const result = service.isEnabled('transactions_api');

    expect(result).toBe(false);
  });

  it('should handle case-insensitive values', () => {
    jest.spyOn(configService, 'get').mockReturnValue('TRUE');

    const result = service.isEnabled('test_flag');

    expect(result).toBe(true);
  });

  it('should handle lowercase true values', () => {
    jest.spyOn(configService, 'get').mockReturnValue('true');

    const result = service.isEnabled('test_flag');

    expect(result).toBe(true);
  });

  it('should convert flag name to uppercase env var', () => {
    jest.spyOn(configService, 'get').mockReturnValue('true');

    service.isEnabled('my_feature_flag');

    expect(configService.get).toHaveBeenCalledWith('FEATURE_MY_FEATURE_FLAG');
  });
});
