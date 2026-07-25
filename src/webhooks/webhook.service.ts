import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import {
  WebhookEndpoint,
  EndpointStatus,
  DeliveryStatus,
} from './domain/webhook-events';
import { SafeLogger } from '../common/safe-logger';
import { WebhookFilterDto } from './dto/webhook-filter.dto';
import * as crypto from 'crypto';

export const WEBHOOK_CACHE_TTL = 60_000;
export const WEBHOOK_ENDPOINT_CACHE_PREFIX = 'webhook:endpoint:';

export interface CreateWebhookEndpointRequest {
  projectId: string;
  url: string;
  events: string[];
  description?: string;
}

export interface UpdateWebhookEndpointRequest {
  url?: string;
  events?: string[];
  description?: string;
  status?: string;
}

export interface PaginatedEndpointsResponse {
  endpoints: WebhookEndpoint[];
  total: number;
  page: number;
  limit: number;
}

export interface PaginatedDeliveriesResponse {
  deliveries: any[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Webhook Management Service
 *
 * Manages webhook endpoint CRUD:
 *   POST   /webhooks/endpoints              – register endpoint
 *   GET    /webhooks/endpoints/project/:id  – list endpoints
 *   GET    /webhooks/endpoints/:id          – get endpoint
 *   PUT    /webhooks/endpoints/:id          – update endpoint
 *   DELETE /webhooks/endpoints/:id          – delete endpoint
 *   POST   /webhooks/endpoints/:id/rotate-secret
 */
@Injectable()
export class WebhookService {
  private readonly logger = new SafeLogger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  /**
   * Creates a new webhook endpoint
   */
  async createEndpoint(
    request: CreateWebhookEndpointRequest,
  ): Promise<WebhookEndpoint> {
    // Generate secret for signing
    const secret = this.generateSecret();

    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        projectId: request.projectId,
        url: request.url,
        events: request.events,
        description: request.description,
        secret,
        status: EndpointStatus.ACTIVE,
      },
    });

    return this.mapPrismaEndpointToDomain(endpoint);
  }

  /**
   * Lists webhook endpoints for a project, with optional status/event
   * filters and pagination.
   */
  async listEndpoints(
    projectId: string,
    filterOrPage?: WebhookFilterDto | number,
    limit?: number,
  ): Promise<{
    endpoints: WebhookEndpoint[];
    total: number;
    page: number;
    limit: number;
  }> {
    let page = 1;
    let take = 20;
    let statusFilter: string | undefined;
    let eventFilter: string | undefined;

    if (typeof filterOrPage === 'object' && filterOrPage !== null) {
      const filter = filterOrPage as WebhookFilterDto;
      page = filter.page ?? 1;
      take = filter.limit ?? 20;
      statusFilter = filter.status;
      eventFilter = filter.event;
    } else if (typeof filterOrPage === 'number') {
      page = filterOrPage;
      take = limit ?? 20;
    }

    const skip = (page - 1) * take;

    const where: any = { projectId };
    if (statusFilter) where.status = statusFilter;
    if (eventFilter) where.events = { has: eventFilter };

    const where: Record<string, unknown> = { projectId };
    if (filter.status) {
      where.status = filter.status;
    }
    if (filter.event) {
      where.events = { has: filter.event };
    }

    const [endpoints, total] = await Promise.all([
      this.prisma.webhookEndpoint.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.webhookEndpoint.count({ where }),
    ]);

    return {
      endpoints: endpoints.map((e) => this.mapPrismaEndpointToDomain(e)),
      total,
      page,
      limit: take,
    };
  }

  /**
   * Gets a webhook endpoint by ID, serving from cache when available.
   */
  async getEndpoint(endpointId: string): Promise<WebhookEndpoint> {
    const cacheKey = `${WEBHOOK_ENDPOINT_CACHE_PREFIX}${endpointId}`;
    const cached = this.cache.get<WebhookEndpoint>(cacheKey);
    if (cached) {
      return cached;
    }

    const endpoint = await this.prisma.webhookEndpoint.findUnique({
      where: { id: endpointId },
    });

    if (!endpoint) {
      throw new NotFoundException(`Webhook endpoint ${endpointId} not found`);
    }

    const mapped = this.mapPrismaEndpointToDomain(endpoint);
    this.cache.set(cacheKey, mapped, WEBHOOK_CACHE_TTL);

    return mapped;
  }

  /**
   * Updates a webhook endpoint
   */
  async updateEndpoint(
    endpointId: string,
    updates: UpdateWebhookEndpointRequest,
  ): Promise<WebhookEndpoint> {
    const endpoint = await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: updates,
    });

    this.invalidateEndpointCache(endpointId);

    return this.mapPrismaEndpointToDomain(endpoint);
  }

  /**
   * Deletes a webhook endpoint
   */
  async deleteEndpoint(endpointId: string): Promise<void> {
    await this.prisma.webhookEndpoint.delete({
      where: { id: endpointId },
    });

    this.invalidateEndpointCache(endpointId);
  }

  /**
   * Rotates the webhook secret
   */
  async rotateSecret(endpointId: string): Promise<{ secret: string }> {
    const newSecret = this.generateSecret();

    await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { secret: newSecret },
    });

    this.invalidateEndpointCache(endpointId);

    return { secret: newSecret };
  }

  /**
   * Gets delivery attempts for an endpoint with pagination
   */
  async getDeliveries(
    endpointId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    // Ensure the endpoint exists so callers get a clear 404 instead of an
    // empty list when they pass an unknown/mistyped id.
    await this.getEndpoint(endpointId);

    const skip = (page - 1) * limit;

    const [deliveries, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where: { endpointId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.webhookDelivery.count({
        where: { endpointId },
      }),
    ]);

    return {
      deliveries,
      page,
      limit,
      total,
      page,
      limit,
    };
  }

  /**
   * Lists dead-lettered deliveries (exhausted all retries) for inspection.
   */
  async getDeadLetters(
    params: { projectId?: string; endpointId?: string; limit?: number } = {},
  ) {
    const { projectId, endpointId, limit = 50 } = params;

    return await this.prisma.webhookDelivery.findMany({
      where: {
        status: DeliveryStatus.FAILED,
        ...(endpointId ? { endpointId } : {}),
        ...(projectId ? { endpoint: { projectId } } : {}),
      },
      include: { endpoint: true },
      orderBy: { lastAttemptAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Requeues a dead-lettered delivery for redelivery by resetting its attempt count.
   * Actual delivery happens on the next dispatcher processing pass.
   */
  async replayDeadLetter(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new NotFoundException(`Webhook delivery ${deliveryId} not found`);
    }

    if (delivery.status !== DeliveryStatus.FAILED) {
      throw new BadRequestException(
        `Delivery ${deliveryId} is not dead-lettered (status: ${delivery.status})`,
      );
    }

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: DeliveryStatus.PENDING,
        attempts: 0,
        nextRetryAt: null,
      },
    });

    this.logger.log(`Requeued dead-lettered delivery ${deliveryId}`);
  }

  /**
   * Generates a secure random secret
   */
  private generateSecret(): string {
    return `whsec_${crypto.randomBytes(32).toString('base64url')}`;
  }

  private invalidateEndpointCache(endpointId: string): void {
    this.cache.delete(`${WEBHOOK_ENDPOINT_CACHE_PREFIX}${endpointId}`);
  }

  /**
   * Maps Prisma endpoint to domain model
   */
  private mapPrismaEndpointToDomain(prismaEndpoint: any): WebhookEndpoint {
    return {
      id: prismaEndpoint.id,
      projectId: prismaEndpoint.projectId,
      url: prismaEndpoint.url,
      description: prismaEndpoint.description,
      secret: prismaEndpoint.secret,
      events: prismaEndpoint.events,
      status: prismaEndpoint.status,
      consecutiveFailures: prismaEndpoint.consecutiveFailures,
      lastFailureAt: prismaEndpoint.lastFailureAt,
      lastFailureReason: prismaEndpoint.lastFailureReason,
      lastSuccessAt: prismaEndpoint.lastSuccessAt,
      createdAt: prismaEndpoint.createdAt,
      updatedAt: prismaEndpoint.updatedAt,
    };
  }
}
