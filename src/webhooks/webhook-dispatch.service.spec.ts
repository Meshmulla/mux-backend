import { Test, TestingModule } from '@nestjs/testing';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { WebhookSignerService } from './webhook-signer.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

jest.mock('axios');

describe('WebhookDispatchService', () => {
  let service: WebhookDispatchService;
  let mockSigner: any;
  let mockMetrics: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockSigner = {
      generateSignatureHeaders: jest.fn(() => ({
        timestamp: Math.floor(Date.now() / 1000),
        signature: 'sig_test',
      })),
      formatSignatureHeader: jest.fn(() => 't=123,v1=sig_test'),
    };

    mockMetrics = {
      incrementCounter: jest.fn(),
      recordHistogram: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue: any) => defaultValue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDispatchService,
        { provide: WebhookSignerService, useValue: mockSigner },
        { provide: MetricsService, useValue: mockMetrics },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WebhookDispatchService>(WebhookDispatchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('deliverWebhook', () => {
    it('should successfully deliver a webhook', async () => {
      const mockedAxios = axios as jest.Mocked<typeof axios>;
      mockedAxios.post.mockResolvedValue({
        status: 200,
        data: { success: true },
      });

      const result = await service.deliverWebhook(
        'https://example.com/webhook',
        { test: 'payload' },
        'wallet.created',
        'evt-123',
        'whsec_secret',
      );

      expect(result.success).toBe(true);
      expect(result.responseStatus).toBe(200);
      expect(result.responseTime).toBeDefined();
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('should include signature headers in request', async () => {
      const mockedAxios = axios as jest.Mocked<typeof axios>;
      mockedAxios.post.mockResolvedValue({
        status: 200,
        data: { success: true },
      });

      await service.deliverWebhook(
        'https://example.com/webhook',
        { test: 'payload' },
        'wallet.created',
        'evt-123',
        'whsec_secret',
      );

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://example.com/webhook',
        { test: 'payload' },
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Webhook-Signature': expect.any(String),
            'X-Webhook-Event-Type': 'wallet.created',
            'X-Webhook-Event-Id': 'evt-123',
          }),
        }),
      );
    });

    it('should handle delivery failure', async () => {
      const mockedAxios = axios as jest.Mocked<typeof axios>;
      mockedAxios.post.mockRejectedValue(
        new Error('Connection refused'),
      );

      const result = await service.deliverWebhook(
        'https://example.com/webhook',
        { test: 'payload' },
        'wallet.created',
        'evt-123',
        'whsec_secret',
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBeDefined();
      expect(result.responseTime).toBeDefined();
    });
  });

  describe('isRetryableError', () => {
    it('should return true for connection errors', () => {
      const error = new Error('Connection refused') as any;
      error.code = 'ECONNREFUSED';

      expect(service.isRetryableError(error)).toBe(true);
    });

    it('should return true for timeout errors', () => {
      const error = new Error('Timeout') as any;
      error.code = 'ETIMEDOUT';

      expect(service.isRetryableError(error)).toBe(true);
    });

    it('should return true for 500 server errors', () => {
      const error = new Error('Server error') as any;
      error.response = { status: 500 };

      expect(service.isRetryableError(error)).toBe(true);
    });

    it('should return false for 4xx client errors', () => {
      const error = new Error('Bad request') as any;
      error.response = { status: 400 };

      expect(service.isRetryableError(error)).toBe(false);
    });
  });
});
