import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import type {
  CreateWebhookEndpointRequest,
  UpdateWebhookEndpointRequest,
} from './webhook.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly webhookDispatcher: WebhookDispatcherService,
  ) {}

  /**
   * Creates a new webhook endpoint
   * 
   * Registers a webhook endpoint for receiving event notifications.
   * The endpoint will receive signed webhook payloads for the specified event types.
   */
  @Post('endpoints')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a webhook endpoint',
    description: `Creates a new webhook endpoint that will receive event notifications.
      
The webhook endpoint will be called with signed POST requests for events specified in the "events" array.
The endpoint must return a 2xx status code to indicate successful delivery.
Webhook signatures are included in the X-Webhook-Signature header and can be verified using the provided secret.

Supported event types:
- wallet.created - Emitted when a wallet is created
- wallet.activated - Emitted when a wallet is activated
- wallet.suspended - Emitted when a wallet is suspended
- wallet.rotated - Emitted when a wallet is rotated
- transaction.created - Emitted when a transaction is initiated
- transaction.pending - Emitted when a transaction is pending
- transaction.confirmed - Emitted when a transaction is confirmed
- transaction.failed - Emitted when a transaction fails
- balance.updated - Emitted when wallet balance is updated
- balance.low - Emitted when wallet balance is low
- balance.mismatch - Emitted when balance discrepancy is detected
- user.created - Emitted when a user is created
- user.updated - Emitted when a user profile is updated`,
  })
  @ApiBody({
    type: 'object',
    examples: {
      default: {
        value: {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          url: 'https://api.example.com/webhooks/mux',
          events: ['wallet.created', 'transaction.confirmed'],
          description: 'Production webhook endpoint',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Webhook endpoint created successfully',
    schema: {
      example: {
        id: 'whep_550e8400e29b41d4a716446655440000',
        url: 'https://api.example.com/webhooks/mux',
        events: ['wallet.created', 'transaction.confirmed'],
        description: 'Production webhook endpoint',
        secret: 'whsec_base64encodedstring',
        status: 'ACTIVE',
        createdAt: '2024-06-24T12:34:56.789Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request parameters',
    schema: {
      example: {
        statusCode: 400,
        message: 'URL must be a valid HTTPS endpoint',
        error: 'Bad Request',
      },
    },
  })
  async createEndpoint(@Body() request: CreateWebhookEndpointRequest) {
    const endpoint = await this.webhookService.createEndpoint(request);

    return {
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      description: endpoint.description,
      secret: endpoint.secret, // Only returned on creation!
      status: endpoint.status,
      createdAt: endpoint.createdAt,
    };
  }

  /**
   * Lists webhook endpoints for a project
   * 
   * Retrieves all webhook endpoints registered for a specific project.
   * Results are paginated and ordered by creation date (newest first).
   */
  @Get('endpoints/project/:projectId')
  @ApiOperation({
    summary: 'List webhook endpoints for a project',
    description: `Retrieves all webhook endpoints for a project with pagination support.
      
Each endpoint includes:
- **id**: Unique endpoint identifier
- **url**: The HTTP endpoint URL where webhooks are sent
- **events**: Array of event types this endpoint subscribes to
- **status**: Current endpoint status (ACTIVE, DISABLED, FAILED)
- **consecutiveFailures**: Number of consecutive delivery failures
- **lastSuccessAt**: Timestamp of last successful delivery
- **lastFailureAt**: Timestamp of last delivery failure
- **lastFailureReason**: Reason for the last failure

Endpoints are automatically disabled after 10 consecutive failures.`,
  })
  @ApiParam({
    name: 'projectId',
    description: 'The project ID to list endpoints for',
    type: 'string',
  })
  @ApiQuery({
    name: 'page',
    description: 'Page number (starting from 1)',
    type: 'number',
    required: false,
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    description: 'Number of items per page (max 100)',
    type: 'number',
    required: false,
    example: 20,
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook endpoints retrieved successfully',
    schema: {
      example: {
        data: [
          {
            id: 'whep_550e8400e29b41d4a716446655440000',
            url: 'https://api.example.com/webhooks/mux',
            events: ['wallet.created', 'transaction.confirmed'],
            description: 'Production webhook endpoint',
            status: 'ACTIVE',
            consecutiveFailures: 0,
            lastSuccessAt: '2024-06-24T12:30:00.000Z',
            lastFailureAt: null,
            lastFailureReason: null,
            createdAt: '2024-06-24T12:34:56.789Z',
            updatedAt: '2024-06-24T12:34:56.789Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      },
    },
  })
  async listEndpoints(
    @Param('projectId') projectId: string,
    @Query() pagination: PaginationDto,
  ) {
    const result = await this.webhookService.listEndpointsPaginated(
      projectId,
      pagination,
    );

    // Don't return secrets in list
    return {
      data: result.data.map((e) => ({
        id: e.id,
        url: e.url,
        events: e.events,
        description: e.description,
        status: e.status,
        consecutiveFailures: e.consecutiveFailures,
        lastSuccessAt: e.lastSuccessAt,
        lastFailureAt: e.lastFailureAt,
        lastFailureReason: e.lastFailureReason,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  /**
   * Gets a specific webhook endpoint by ID
   * 
   * Retrieves detailed information about a webhook endpoint.
   * The endpoint secret is NOT returned; it is only provided at creation time.
   */
  @Get('endpoints/:id')
  @ApiOperation({
    summary: 'Get webhook endpoint details',
    description: `Retrieves detailed information about a specific webhook endpoint.
      
The endpoint secret is never returned in this endpoint for security reasons.
To update the secret, use the rotate-secret endpoint.`,
  })
  @ApiParam({
    name: 'id',
    description: 'The webhook endpoint ID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook endpoint details retrieved successfully',
    schema: {
      example: {
        id: 'whep_550e8400e29b41d4a716446655440000',
        url: 'https://api.example.com/webhooks/mux',
        events: ['wallet.created', 'transaction.confirmed'],
        description: 'Production webhook endpoint',
        status: 'ACTIVE',
        consecutiveFailures: 0,
        lastSuccessAt: '2024-06-24T12:30:00.000Z',
        lastFailureAt: null,
        lastFailureReason: null,
        createdAt: '2024-06-24T12:34:56.789Z',
        updatedAt: '2024-06-24T12:34:56.789Z',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Webhook endpoint not found',
  })
  async getEndpoint(@Param('id') id: string) {
    const endpoint = await this.webhookService.getEndpoint(id);

    return {
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      description: endpoint.description,
      status: endpoint.status,
      consecutiveFailures: endpoint.consecutiveFailures,
      lastSuccessAt: endpoint.lastSuccessAt,
      lastFailureAt: endpoint.lastFailureAt,
      lastFailureReason: endpoint.lastFailureReason,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
      // Note: Secret not returned in GET
    };
  }

  /**
   * Updates a webhook endpoint
   * 
   * Modifies an existing webhook endpoint's configuration.
   * You can update the URL, subscribed events, description, or status.
   */
  @Put('endpoints/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a webhook endpoint',
    description: `Updates the configuration of an existing webhook endpoint.
      
You can update:
- **url**: The HTTP endpoint URL (must be HTTPS)
- **events**: Array of event types to subscribe to
- **description**: Human-readable description
- **status**: Endpoint status (ACTIVE or DISABLED)`,
  })
  @ApiParam({
    name: 'id',
    description: 'The webhook endpoint ID',
    type: 'string',
  })
  @ApiBody({
    type: 'object',
    examples: {
      default: {
        value: {
          url: 'https://api.example.com/webhooks/mux-updated',
          events: ['wallet.created', 'transaction.confirmed', 'balance.updated'],
          description: 'Updated production webhook endpoint',
          status: 'ACTIVE',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook endpoint updated successfully',
    schema: {
      example: {
        id: 'whep_550e8400e29b41d4a716446655440000',
        url: 'https://api.example.com/webhooks/mux-updated',
        events: ['wallet.created', 'transaction.confirmed', 'balance.updated'],
        description: 'Updated production webhook endpoint',
        status: 'ACTIVE',
        updatedAt: '2024-06-24T13:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Webhook endpoint not found',
  })
  async updateEndpoint(
    @Param('id') id: string,
    @Body() updates: UpdateWebhookEndpointRequest,
  ) {
    const endpoint = await this.webhookService.updateEndpoint(id, updates);

    return {
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      description: endpoint.description,
      status: endpoint.status,
      updatedAt: endpoint.updatedAt,
    };
  }

  /**
   * Deletes a webhook endpoint
   * 
   * Permanently removes a webhook endpoint. No further events will be sent to this endpoint.
   */
  @Delete('endpoints/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a webhook endpoint',
    description: `Permanently deletes a webhook endpoint and stops sending events to it.
      
This action cannot be undone.`,
  })
  @ApiParam({
    name: 'id',
    description: 'The webhook endpoint ID',
    type: 'string',
  })
  @ApiResponse({
    status: 204,
    description: 'Webhook endpoint deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Webhook endpoint not found',
  })
  async deleteEndpoint(@Param('id') id: string) {
    await this.webhookService.deleteEndpoint(id);
  }

  /**
   * Rotates the webhook signing secret
   * 
   * Generates a new secret for the webhook endpoint and returns it.
   * The old secret will no longer be valid for verifying webhook signatures.
   */
  @Post('endpoints/:id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate webhook endpoint secret',
    description: `Generates a new signing secret for the webhook endpoint.
      
The new secret is returned only in this response. Store it securely.
After rotation, webhooks will be signed with the new secret.
Old signatures cannot be verified with the new secret.`,
  })
  @ApiParam({
    name: 'id',
    description: 'The webhook endpoint ID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'New webhook secret generated successfully',
    schema: {
      example: {
        secret: 'whsec_base64encodedstring',
        rotatedAt: '2024-06-24T13:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Webhook endpoint not found',
  })
  async rotateSecret(@Param('id') id: string) {
    const result = await this.webhookService.rotateSecret(id);

    return {
      secret: result.secret, // Only time new secret is returned!
      rotatedAt: new Date(),
    };
  }

  /**
   * Gets delivery history for an endpoint
   * 
   * Retrieves the delivery history of webhooks sent to an endpoint.
   * Includes delivery status, attempts, response details, and retry information.
   */
  @Get('endpoints/:id/deliveries')
  @ApiOperation({
    summary: 'Get webhook delivery history',
    description: `Retrieves the delivery history for a webhook endpoint.
      
Each delivery record includes:
- **id**: Unique delivery ID
- **eventId**: ID of the event that triggered this delivery
- **eventType**: Type of event (e.g., wallet.created)
- **status**: Delivery status (PENDING, DELIVERED, FAILED, RETRYING)
- **attempts**: Number of delivery attempts made
- **maxAttempts**: Maximum attempts allowed (typically 5)
- **nextRetryAt**: When the next retry will be attempted (if applicable)
- **responseStatus**: HTTP status code from the last attempt
- **responseTime**: Response time in milliseconds
- **firstAttemptAt**: Timestamp of first delivery attempt
- **lastAttemptAt**: Timestamp of last delivery attempt
- **deliveredAt**: Timestamp when delivery succeeded
- **errorMessage**: Error message if delivery failed

Delivery attempts use exponential backoff: 1s, 2s, 4s, 8s, 16s.
Failed deliveries after max attempts are abandoned.`,
  })
  @ApiParam({
    name: 'id',
    description: 'The webhook endpoint ID',
    type: 'string',
  })
  @ApiQuery({
    name: 'page',
    description: 'Page number (starting from 1)',
    type: 'number',
    required: false,
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    description: 'Number of items per page (max 100)',
    type: 'number',
    required: false,
    example: 20,
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook delivery history retrieved successfully',
    schema: {
      example: {
        endpointId: 'whep_550e8400e29b41d4a716446655440000',
        data: [
          {
            id: 'whd_550e8400e29b41d4a716446655440001',
            eventId: 'evt_550e8400e29b41d4a716446655440002',
            eventType: 'wallet.created',
            status: 'DELIVERED',
            attempts: 1,
            maxAttempts: 5,
            responseStatus: 200,
            responseTime: 45,
            nextRetryAt: null,
            firstAttemptAt: '2024-06-24T12:34:00.000Z',
            lastAttemptAt: '2024-06-24T12:34:00.000Z',
            deliveredAt: '2024-06-24T12:34:00.000Z',
            errorMessage: null,
            createdAt: '2024-06-24T12:34:56.789Z',
          },
          {
            id: 'whd_550e8400e29b41d4a716446655440003',
            eventId: 'evt_550e8400e29b41d4a716446655440004',
            eventType: 'transaction.confirmed',
            status: 'RETRYING',
            attempts: 2,
            maxAttempts: 5,
            responseStatus: 503,
            responseTime: 15000,
            nextRetryAt: '2024-06-24T12:35:04.000Z',
            firstAttemptAt: '2024-06-24T12:34:00.000Z',
            lastAttemptAt: '2024-06-24T12:34:02.000Z',
            deliveredAt: null,
            errorMessage: 'Service Unavailable',
            createdAt: '2024-06-24T12:34:56.789Z',
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Webhook endpoint not found',
  })
  async getDeliveries(
    @Param('id') id: string,
    @Query() pagination: PaginationDto,
  ) {
    const result = await this.webhookService.getDeliveriesPaginated(
      id,
      pagination,
    );

    return {
      endpointId: id,
      data: result.data.map((d) => ({
        id: d.id,
        eventId: d.eventId,
        eventType: d.eventType,
        status: d.status,
        attempts: d.attempts,
        maxAttempts: d.maxAttempts,
        responseStatus: d.responseStatus,
        responseTime: d.responseTime,
        nextRetryAt: d.nextRetryAt,
        firstAttemptAt: d.firstAttemptAt,
        lastAttemptAt: d.lastAttemptAt,
        deliveredAt: d.deliveredAt,
        errorMessage: d.errorMessage,
        createdAt: d.createdAt,
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  /**
   * Manually triggers webhook delivery processing (admin only)
   * 
   * Processes all pending and retrying webhook deliveries immediately.
   * Normally, deliveries are processed automatically in the background.
   * This endpoint is useful for testing or debugging webhook delivery issues.
   */
  @Post('process-deliveries')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually process pending webhooks',
    description: `Triggers immediate processing of all pending and retrying webhook deliveries.
      
This endpoint processes:
- All deliveries with status PENDING
- All deliveries with status RETRYING where nextRetryAt <= now()

Each delivery attempts to send the webhook to the endpoint URL with:
- Signed request headers for verification
- JSON payload with event data
- Exponential backoff retry strategy

Admin/internal use only.`,
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook delivery processing completed',
    schema: {
      example: {
        processed: 25,
        delivered: 20,
        failed: 3,
        retrying: 2,
      },
    },
  })
  async processDeliveries() {
    const result = await this.webhookDispatcher.processDeliveries();

    return {
      processed: result.delivered + result.failed + result.retrying,
      delivered: result.delivered,
      failed: result.failed,
      retrying: result.retrying,
    };
  }
}
