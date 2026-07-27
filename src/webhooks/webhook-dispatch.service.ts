import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookSignerService } from './webhook-signer.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { createRequestIdAwareAxios } from '../common/http/request-id-axios';
import { AxiosError } from 'axios';

export interface WebhookDispatchResult {
  success: boolean;
  responseTime: number;
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
}

/**
 * Webhook Dispatch Service
 *
 * Responsible only for:
 * - Building the webhook payload
 * - Signing the payload
 * - Making the outbound HTTP call
 */
@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);
  private readonly requestTimeoutMs: number;
  private readonly http = createRequestIdAwareAxios();

  constructor(
    private readonly webhookSigner: WebhookSignerService,
    private readonly configService: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    this.requestTimeoutMs = this.configService.get<number>(
      'WEBHOOK_TIMEOUT_MS',
      10000,
    );
  }

  /**
   * Attempts to deliver a webhook payload to an endpoint
   */
  async deliverWebhook(
    url: string,
    payload: any,
    eventType: string,
    eventId: string,
    secret: string,
  ): Promise<WebhookDispatchResult> {
    const startTime = Date.now();

    this.logger.log(`Delivering webhook to ${url} (event: ${eventType})`);

    try {
      // Sign the payload
      const { timestamp, signature } =
        this.webhookSigner.generateSignatureHeaders(payload, secret);

      // Make HTTP request (x-request-id is automatically propagated)
      const response = await this.http.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event-Type': eventType,
          'X-Webhook-Event-Id': eventId,
          'X-Webhook-Signature': this.webhookSigner.formatSignatureHeader(
            timestamp,
            signature,
          ),
          'User-Agent': 'Mux-Webhooks/1.0',
        },
        timeout: this.requestTimeoutMs,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      const responseTime = Date.now() - startTime;

      this.logger.log(`Successfully delivered webhook in ${responseTime}ms`);

      return {
        success: true,
        responseTime,
        responseStatus: response.status,
        responseBody: JSON.stringify(response.data).substring(0, 1000),
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const axiosError = error as AxiosError;

      const responseStatus = axiosError.response?.status;
      const responseBody = axiosError.response?.data
        ? JSON.stringify(axiosError.response.data).substring(0, 500)
        : axiosError.message;

      this.logger.warn(
        `Webhook delivery failed: ${axiosError.message}`,
      );

      return {
        success: false,
        responseTime,
        responseStatus,
        responseBody,
        errorMessage: axiosError.message.substring(0, 500),
      };
    }
  }

  /**
   * Determines if an error is retryable
   */
  isRetryableError(error: AxiosError): boolean {
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
}
