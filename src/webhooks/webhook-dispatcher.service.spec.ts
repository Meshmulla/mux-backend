import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookSignerService } from './webhook-signer.service';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import {
  DeliveryStatus,
  EndpointStatus,
  WebhookEventType,
} from './domain/webhook-events';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const ENDPOINT_ID = 'endpoint-1';
const DELIVERY_ID = 'delivery-1';
const REQUEST_ID = 'incoming-request-id-abc';

const mockEvent = {
  id: 'evt_123',
  type: WebhookEventType.WALLET_CREATED,
  createdAt: new Date(),
  data: { walletId: 'wallet-1' },
};

const mockEndpoint = {
  id: ENDPOINT_ID,
  projectId: 'project-1',
  url: 'https://example.com/hook',
  secret: 'whsec_test',
  events: [WebhookEventType.WALLET_CREATED],
  status: EndpointStatus.ACTIVE,
  consecutiveFailures: 0,
};

const mockDelivery = {
  id: DELIVERY_ID,
  endpointId: ENDPOINT_ID,
  eventId: mockEvent.id,
  eventType: mockEvent.type,
  payload: mockEvent,
  status: DeliveryStatus.PENDING,
  attempts: 0,
  maxAttempts: 5,
  endpoint: mockEndpoint,
};

describe('WebhookDispatcherService', () => {
  let service: WebhookDispatcherService;
  let requestContext: RequestContextService;

  const mockPrisma = {
    webhookEndpoint: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    webhookDelivery: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDispatcherService,
        WebhookSignerService,
        RequestContextService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
          },
        },
      ],
    }).compile();

    service = module.get<WebhookDispatcherService>(WebhookDispatcherService);
    requestContext = module.get<RequestContextService>(RequestContextService);

    mockedAxios.post.mockResolvedValue({ status: 200, data: { ok: true } });
    mockPrisma.webhookDelivery.update.mockResolvedValue({});
    mockPrisma.webhookEndpoint.update.mockResolvedValue(mockEndpoint);
  });

  describe('request ID propagation', () => {
    it('forwards x-request-id on outbound webhook HTTP calls when present in context', async () => {
      mockPrisma.webhookDelivery.findMany.mockResolvedValue([mockDelivery]);

      await RequestContextService.run({ requestId: REQUEST_ID }, async () => {
        await service.processDeliveries();
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockEndpoint.url,
        mockEvent,
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-request-id': REQUEST_ID,
          }),
        }),
      );
    });

    it('omits x-request-id header when no request ID is in context', async () => {
      mockPrisma.webhookDelivery.findMany.mockResolvedValue([mockDelivery]);

      await service.processDeliveries();

      const callArgs = mockedAxios.post.mock.calls[0];
      const headers = callArgs[2]?.headers as Record<string, string>;
      expect(headers['x-request-id']).toBeUndefined();
    });

    it('includes requestId in structured log output for webhook operations', async () => {
      mockPrisma.webhookEndpoint.findMany.mockResolvedValue([mockEndpoint]);
      mockPrisma.webhookDelivery.create.mockResolvedValue({});
      mockPrisma.webhookDelivery.findMany.mockResolvedValue([]);

      const logSpy = jest.spyOn(service['logger'], 'log');

      await RequestContextService.run({ requestId: REQUEST_ID }, async () => {
        await service.dispatchEvent({ event: mockEvent });
      });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(`"requestId":"${REQUEST_ID}"`),
      );
    });
  });
});
