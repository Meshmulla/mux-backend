import { Test, TestingModule } from '@nestjs/testing';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookSignerService } from './webhook-signer.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import { DeliveryStatus, EndpointStatus } from './domain/webhook-events';
import axios from 'axios';

jest.mock('axios');

describe('WebhookDispatcherService', () => {
  let service: WebhookDispatcherService;
  let mockPrisma: any;
  let mockSigner: any;
  let mockMetrics: any;
  let mockConfigService: any;

  const mockEndpoint = {
    id: 'endpoint-1',
    url: 'https://example.com/webhook',
    secret: 'whsec_test',
    status: EndpointStatus.ACTIVE,
    projectId: 'project-1',
    consecutiveFailures: 0,
  };

  const mockDelivery = {
    id: 'delivery-1',
    eventType: 'wallet.created',
    eventId: 'evt-123',
    payload: { test: 'data' },
    attempts: 0,
    endpoint: mockEndpoint,
  };

  beforeEach(async () => {
    mockPrisma = {
      webhookEndpoint: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      webhookDelivery: {
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };

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
        WebhookDispatcherService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WebhookSignerService, useValue: mockSigner },
        { provide: MetricsService, useValue: mockMetrics },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WebhookDispatcherService>(WebhookDispatcherService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('metrics instrumentation', () => {
    it('should increment webhooks_dispatched_total on dispatch', async () => {
      const event = {
        id: 'evt-123',
        type: 'wallet.created',
      };

      mockPrisma.webhookEndpoint.findMany.mockResolvedValue([]);

      await service.dispatchEvent({ event });

      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
        'webhooks_dispatched_total',
        { event_type: 'wallet.created' },
      );
    });

    it('should increment webhooks_delivered_total with success on successful delivery', async () => {
      const mockedAxios = axios as jest.Mocked<typeof axios>;
      mockedAxios.post.mockResolvedValue({
        status: 200,
        data: { success: true },
      });

      mockPrisma.webhookEndpoint.findUnique.mockResolvedValue(mockEndpoint);
      mockPrisma.webhookDelivery.update.mockResolvedValue(mockDelivery);

      await service['attemptDelivery'](mockDelivery);

      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
        'webhooks_delivered_total',
        { event_type: 'wallet.created', result: 'success' },
      );
    });

    it('should increment webhooks_delivered_total with failure on failed delivery', async () => {
      const mockedAxios = axios as jest.Mocked<typeof axios>;
      mockedAxios.post.mockRejectedValue(
        new Error('Connection refused'),
      );

      mockPrisma.webhookEndpoint.findUnique.mockResolvedValue(mockEndpoint);
      mockPrisma.webhookDelivery.update.mockResolvedValue(mockDelivery);

      await service['attemptDelivery'](mockDelivery);

      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
        'webhooks_delivered_total',
        { event_type: 'wallet.created', result: 'failure' },
      );
    });

    it('should increment webhooks_retry_total on retry', async () => {
      const mockedAxios = axios as jest.Mocked<typeof axios>;
      mockedAxios.post.mockRejectedValue({
        response: { status: 500 },
        message: 'Server error',
      });

      mockPrisma.webhookEndpoint.findUnique.mockResolvedValue(mockEndpoint);
      mockPrisma.webhookDelivery.update.mockResolvedValue(mockDelivery);

      const deliveryFirstAttempt = { ...mockDelivery, attempts: 0 };
      const result = await service['attemptDelivery'](deliveryFirstAttempt);

      expect(result).toBe(DeliveryStatus.RETRYING);
      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
        'webhooks_retry_total',
        { event_type: 'wallet.created' },
      );
    });

    it('should record webhook_delivery_duration_seconds on successful delivery', async () => {
      const mockedAxios = axios as jest.Mocked<typeof axios>;
      mockedAxios.post.mockResolvedValue({
        status: 200,
        data: { success: true },
      });

      mockPrisma.webhookEndpoint.findUnique.mockResolvedValue(mockEndpoint);
      mockPrisma.webhookDelivery.update.mockResolvedValue(mockDelivery);

      await service['attemptDelivery'](mockDelivery);

      expect(mockMetrics.recordHistogram).toHaveBeenCalledWith(
        'webhook_delivery_duration_seconds',
        expect.any(Number),
        { event_type: 'wallet.created' },
      );
    });

    it('should increment webhooks_dead_letter_total when max retries exceeded', async () => {
      const mockedAxios = axios as jest.Mocked<typeof axios>;
      mockedAxios.post.mockRejectedValue({
        response: { status: 500 },
        message: 'Server error',
      });

      mockPrisma.webhookEndpoint.findUnique.mockResolvedValue(mockEndpoint);
      mockPrisma.webhookDelivery.update.mockResolvedValue(mockDelivery);

      const maxRetriesDelivery = { ...mockDelivery, attempts: 4 }; // 5 total attempts

      const result = await service['attemptDelivery'](maxRetriesDelivery);

      expect(result).toBe(DeliveryStatus.FAILED);
      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
        'webhooks_dead_letter_total',
        { event_type: 'wallet.created' },
      );
    });
  });
});
