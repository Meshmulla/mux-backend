import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { WebhookSignerService } from './webhook-signer.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import {
  WebhookEvent,
  DeliveryStatus,
  EndpointStatus,
} from './domain/webhook-events';
import axios, { AxiosError } from 'axios';

export interface DispatchEventRequest {
  event: WebhookEvent;
  projectId?: string; // Optional: dispatch only to specific project
}

/**
 * Webhook Dispatcher Service
 *
 * Responsibilities:
 * - Dispatch events to registered webhook endpoints
 * - Retry failed deliveries with exponential backoff
 * - Sign payloads for verification
 * - Track delivery attempts and status
 * - Disable failing endpoints automatically
 */
@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxConsecutiveFailures: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhookSigner: WebhookSignerService,
    private readonly configService: ConfigService,
    private readonly requestContext: RequestContextService,
  ) {
    this.maxRetries = this.configService.get<number>('WEBHOOK_MAX_RETRIES', 5);
    this.retryBackoffMs = this.configService.get<number>(
      'WEBHOOK_RETRY_BACKOFF_MS',
      1000,
    );
    this.requestTimeoutMs = this.configService.get<number>(
      'WEBHOOK_TIMEOUT_MS',
      10000,
    );
    this.maxConsecutiveFailures = this.configService.get<number>(
      'WEBHOOK_MAX_CONSECUTIVE_FAILURES',
      10,
    );
  }

  /**
   * Dispatches an event to all registered webhooks
   */
  async dispatchEvent(request: DispatchEventRequest): Promise<void> {
    const { event, projectId } = request;

    this.log('log', 'Dispatching webhook event', {
      eventType: event.type,
      eventId: event.id,
    });

    // Find all endpoints subscribed to this event type
    const endpoints = await this.findSubscribedEndpoints(event.type, projectId);

    if (endpoints.length === 0) {
      this.log('log', 'No endpoints subscribed to event type', {
        eventType: event.type,
      });
      return;
    }

    this.log('log', 'Found subscribed endpoints', {
      eventType: event.type,
      endpointCount: endpoints.length,
    });

    // Create delivery records for each endpoint
    for (const endpoint of endpoints) {
      await this.createDelivery(endpoint, event);
    }

    // Attempt immediate delivery (async)
    this.processDeliveries().catch((err) =>
      this.log('error', 'Background delivery processing failed', {
        error: err?.message ?? String(err),
      }),
    );
  }

  /**
   * Processes pending deliveries
   */
  async processDeliveries(): Promise<{
    delivered: number;
    failed: number;
    retrying: number;
  }> {
    const startTime = Date.now();

    // Find deliveries that need to be attempted
    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: {
        OR: [
          { status: DeliveryStatus.PENDING },
          {
            status: DeliveryStatus.RETRYING,
            nextRetryAt: { lte: new Date() },
          },
        ],
        attempts: { lt: this.maxRetries },
      },
      include: {
        endpoint: true,
      },
      take: 100, // Process in batches
    });

    let delivered = 0;
    let failed = 0;
    let retrying = 0;

    for (const delivery of deliveries) {
      try {
        const result = await this.attemptDelivery(delivery);

        if (result === DeliveryStatus.DELIVERED) {
          delivered++;
        } else if (result === DeliveryStatus.FAILED) {
          failed++;
        } else if (result === DeliveryStatus.RETRYING) {
          retrying++;
        }
      } catch (error) {
        this.log('error', 'Delivery attempt failed', {
          deliveryId: delivery.id,
          error: (error as Error)?.message ?? String(error),
        });
        failed++;
      }
    }

    const duration = Date.now() - startTime;
    this.log('log', 'Processed webhook deliveries', {
      total: deliveries.length,
      delivered,
      failed,
      retrying,
      durationMs: duration,
    });

    return { delivered, failed, retrying };
  }

  /**
   * Attempts to deliver a webhook
   */
  private async attemptDelivery(delivery: any): Promise<DeliveryStatus> {
    const { endpoint } = delivery;

    // Skip disabled endpoints
    if (endpoint.status !== EndpointStatus.ACTIVE) {
      this.log('warn', 'Skipping delivery to disabled endpoint', {
        endpointId: endpoint.id,
        deliveryId: delivery.id,
      });
      return DeliveryStatus.FAILED;
    }

    const attemptNumber = delivery.attempts + 1;
    const startTime = Date.now();

    this.log('log', 'Attempting webhook delivery', {
      deliveryId: delivery.id,
      endpointId: endpoint.id,
      endpointUrl: endpoint.url,
      attempt: attemptNumber,
      maxAttempts: this.maxRetries,
    });

    try {
      // Sign the payload
      const { timestamp, signature } =
        this.webhookSigner.generateSignatureHeaders(
          delivery.payload,
          endpoint.secret,
        );

      const requestId = this.requestContext.getRequestId();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Webhook-Event-Type': delivery.eventType,
        'X-Webhook-Event-Id': delivery.eventId,
        'X-Webhook-Signature': this.webhookSigner.formatSignatureHeader(
          timestamp,
          signature,
        ),
        'User-Agent': 'Mux-Webhooks/1.0',
      };

      if (requestId) {
        headers['x-request-id'] = requestId;
      }

      // Make HTTP request
      const response = await axios.post(endpoint.url, delivery.payload, {
        headers,
        timeout: this.requestTimeoutMs,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      const responseTime = Date.now() - startTime;

      // Success!
      await this.markDelivered(
        delivery.id,
        response.status,
        response.data,
        responseTime,
      );
      await this.markEndpointSuccess(endpoint.id);

      this.log('log', 'Webhook delivery succeeded', {
        deliveryId: delivery.id,
        endpointId: endpoint.id,
        responseStatus: response.status,
        responseTimeMs: responseTime,
      });
      return DeliveryStatus.DELIVERED;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const axiosError = error as AxiosError;

      const responseStatus = axiosError.response?.status;
      const responseBody = axiosError.response?.data
        ? JSON.stringify(axiosError.response.data).substring(0, 500)
        : axiosError.message;

      this.log('warn', 'Webhook delivery failed', {
        deliveryId: delivery.id,
        endpointId: endpoint.id,
        attempt: attemptNumber,
        responseStatus,
        error: axiosError.message,
      });

      // Determine if we should retry
      const shouldRetry =
        attemptNumber < this.maxRetries && this.isRetryableError(axiosError);

      if (shouldRetry) {
        const nextRetryAt = this.calculateNextRetry(attemptNumber);
        await this.markRetrying(
          delivery.id,
          attemptNumber,
          nextRetryAt,
          responseStatus,
          responseBody,
          responseTime,
          axiosError.message,
        );
        return DeliveryStatus.RETRYING;
      } else {
        await this.markFailed(
          delivery.id,
          attemptNumber,
          responseStatus,
          responseBody,
          responseTime,
          axiosError.message,
        );
        await this.markEndpointFailure(endpoint.id, axiosError.message);
        return DeliveryStatus.FAILED;
      }
    }
  }

  /**
   * Determines if an error is retryable
   */
  private isRetryableError(error: AxiosError): boolean {
    if (
      error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND'
    ) {
      return true;
    }

    const status = error.response?.status;
    if (!status) return true; // Network errors are retryable

    // Retry on server errors, not client errors
    return status >= 500;
  }

  /**
   * Calculates next retry time with exponential backoff
   */
  private calculateNextRetry(attemptNumber: number): Date {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delayMs = this.retryBackoffMs * Math.pow(2, attemptNumber - 1);
    return new Date(Date.now() + delayMs);
  }

  /**
   * Finds endpoints subscribed to an event type
   */
  private async findSubscribedEndpoints(eventType: string, projectId?: string) {
    return await this.prisma.webhookEndpoint.findMany({
      where: {
        status: EndpointStatus.ACTIVE,
        events: { has: eventType },
        ...(projectId ? { projectId } : {}),
      },
    });
  }

  /**
   * Creates a delivery record
   */
  private async createDelivery(
    endpoint: any,
    event: WebhookEvent,
  ): Promise<void> {
    await this.prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        eventId: event.id,
        eventType: event.type,
        payload: JSON.parse(JSON.stringify(event)),
        status: DeliveryStatus.PENDING,
        attempts: 0,
        maxAttempts: this.maxRetries,
      },
    });
  }

  /**
   * Marks delivery as delivered
   */
  private async markDelivered(
    deliveryId: string,
    status: number,
    body: any,
    responseTime: number,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: DeliveryStatus.DELIVERED,
        deliveredAt: new Date(),
        lastAttemptAt: new Date(),
        responseStatus: status,
        responseBody: JSON.stringify(body).substring(0, 1000),
        responseTime,
      },
    });
  }

  /**
   * Marks delivery as retrying
   */
  private async markRetrying(
    deliveryId: string,
    attempts: number,
    nextRetryAt: Date,
    responseStatus: number | undefined,
    responseBody: string,
    responseTime: number,
    errorMessage: string,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: DeliveryStatus.RETRYING,
        attempts,
        nextRetryAt,
        lastAttemptAt: new Date(),
        firstAttemptAt: attempts === 1 ? new Date() : undefined,
        responseStatus,
        responseBody: responseBody.substring(0, 1000),
        responseTime,
        errorMessage: errorMessage.substring(0, 500),
      },
    });
  }

  /**
   * Marks delivery as failed
   */
  private async markFailed(
    deliveryId: string,
    attempts: number,
    responseStatus: number | undefined,
    responseBody: string,
    responseTime: number,
    errorMessage: string,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: DeliveryStatus.FAILED,
        attempts,
        lastAttemptAt: new Date(),
        responseStatus,
        responseBody: responseBody.substring(0, 1000),
        responseTime,
        errorMessage: errorMessage.substring(0, 500),
      },
    });
  }

  /**
   * Marks endpoint success
   */
  private async markEndpointSuccess(endpointId: string): Promise<void> {
    await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: {
        consecutiveFailures: 0,
        lastSuccessAt: new Date(),
      },
    });
  }

  /**
   * Marks endpoint failure and disables if needed
   */
  private async markEndpointFailure(
    endpointId: string,
    reason: string,
  ): Promise<void> {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({
      where: { id: endpointId },
    });

    if (!endpoint) return;

    const newFailureCount = endpoint.consecutiveFailures + 1;
    const shouldDisable = newFailureCount >= this.maxConsecutiveFailures;

    await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: {
        consecutiveFailures: newFailureCount,
        lastFailureAt: new Date(),
        lastFailureReason: reason.substring(0, 500),
        status: shouldDisable ? EndpointStatus.FAILED : endpoint.status,
      },
    });

    if (shouldDisable) {
      this.log('warn', 'Disabled webhook endpoint after consecutive failures', {
        endpointId,
        consecutiveFailures: newFailureCount,
      });
    }
  }

  private log(
    level: 'log' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown> = {},
  ): void {
    const requestId = this.requestContext.getRequestId();
    const payload = {
      message,
      ...(requestId ? { requestId } : {}),
      ...context,
    };
    this.logger[level](JSON.stringify(payload));
  }
}
