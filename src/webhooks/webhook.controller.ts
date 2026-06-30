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
  UseGuards,
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
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';
import { FeatureFlagGuard } from '../common/feature-flags/feature-flag.guard';
import { FeatureFlag } from '../common/feature-flags/feature-flag.guard';

@ApiTags('webhooks')
@Controller('webhooks')
@UseGuards(FeatureFlagGuard)
@FeatureFlag('webhooks_enabled')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly webhookDispatcher: WebhookDispatcherService,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /webhooks/endpoints
  // ---------------------------------------------------------------------------

  @ApiOperation({ summary: 'Register a new webhook endpoint' })
  @ApiBody({
    type: CreateWebhookEndpointDto,
    examples: {
      default: {
        value: {
          projectId: 'project-uuid',
          url: 'https://example.com/webhook',
          events: ['wallet.created', 'transaction.confirmed'],
          description: 'My webhook endpoint',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Webhook endpoint created. Secret is only returned on creation.',
    example: {
      id: 'endpoint-uuid',
      url: 'https://example.com/webhook',
      events: ['wallet.created', 'transaction.confirmed'],
      description: 'My webhook endpoint',
      secret: 'whsec_abc123...',
      status: 'ACTIVE',
      createdAt: '2024-06-24T12:00:00.000Z',
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid input',
    example: {
      statusCode: 400,
      message: ['url must be a valid URL', 'events must not be empty'],
      error: 'Bad Request',
    },
  })
  @Post('endpoints')
  @HttpCode(HttpStatus.CREATED)
  async createEndpoint(@Body() request: CreateWebhookEndpointDto) {
    const endpoint = await this.webhookService.createEndpoint(request);

    return {
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      description: endpoint.description,
      secret: endpoint.secret,
      status: endpoint.status,
      createdAt: endpoint.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /webhooks/endpoints/project/:projectId
  // ---------------------------------------------------------------------------

  @ApiOperation({ summary: 'List webhook endpoints for a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID', example: 'project-uuid' })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number (starting from 1)' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Items per page (max 100)' })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'DISABLED', 'FAILED'], description: 'Filter by endpoint status' })
  @ApiQuery({ name: 'event', required: false, example: 'wallet.created', description: 'Filter by subscribed event type' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of webhook endpoints',
    example: {
      endpoints: [
        {
          id: 'endpoint-uuid',
          url: 'https://example.com/webhook',
          events: ['wallet.created'],
          description: 'My webhook',
          status: 'ACTIVE',
          consecutiveFailures: 0,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastFailureReason: null,
          createdAt: '2024-06-24T12:00:00.000Z',
          updatedAt: '2024-06-24T12:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    },
  })
  @Get('endpoints/project/:projectId')
  async listEndpoints(
    @Param('projectId') projectId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Math.max(1, parseInt(page || '1', 10));
    const pageLimit = Math.min(100, Math.max(1, parseInt(limit || '20', 10)));

    const result = await this.webhookService.listEndpoints(
      projectId,
      pageNumber,
      pageLimit,
    );

    return {
      page: pageNumber,
      limit: pageLimit,
      total: result.total,
      endpoints: result.endpoints.map((e) => ({
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
    };
  }

  // ---------------------------------------------------------------------------
  // GET /webhooks/endpoints/:id
  // ---------------------------------------------------------------------------

  @ApiOperation({ summary: 'Get a specific webhook endpoint' })
  @ApiParam({ name: 'id', description: 'Webhook endpoint ID', example: 'endpoint-uuid' })
  @ApiResponse({
    status: 200,
    description: 'Webhook endpoint details (secret is never returned here)',
    example: {
      id: 'endpoint-uuid',
      url: 'https://example.com/webhook',
      events: ['wallet.created', 'transaction.confirmed'],
      description: 'My webhook endpoint',
      status: 'ACTIVE',
      consecutiveFailures: 0,
      lastSuccessAt: '2024-06-24T13:00:00.000Z',
      lastFailureAt: null,
      lastFailureReason: null,
      createdAt: '2024-06-24T12:00:00.000Z',
      updatedAt: '2024-06-24T13:00:00.000Z',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Endpoint not found',
    example: {
      statusCode: 404,
      message: 'Webhook endpoint not found',
      error: 'Not Found',
    },
  })
  @Get('endpoints/:id')
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
      // Note: secret is never returned on GET
    };
  }

  // ---------------------------------------------------------------------------
  // PUT /webhooks/endpoints/:id
  // ---------------------------------------------------------------------------

  @ApiOperation({ summary: 'Update a webhook endpoint' })
  @ApiParam({ name: 'id', description: 'Webhook endpoint ID', example: 'endpoint-uuid' })
  @ApiBody({
    type: UpdateWebhookEndpointDto,
    examples: {
      updateUrl: {
        summary: 'Change URL and subscribed events',
        value: {
          url: 'https://example.com/new-webhook',
          events: ['wallet.created', 'balance.updated'],
        },
      },
      disable: {
        summary: 'Disable the endpoint',
        value: {
          status: 'DISABLED',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Endpoint updated successfully',
    example: {
      id: 'endpoint-uuid',
      url: 'https://example.com/new-webhook',
      events: ['wallet.created', 'balance.updated'],
      description: 'My webhook endpoint',
      status: 'ACTIVE',
      updatedAt: '2024-06-24T14:00:00.000Z',
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid input',
    example: {
      statusCode: 400,
      message: ['url must be a valid URL'],
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Endpoint not found',
    example: {
      statusCode: 404,
      message: 'Webhook endpoint not found',
      error: 'Not Found',
    },
  })
  @Put('endpoints/:id')
  @HttpCode(HttpStatus.OK)
  async updateEndpoint(
    @Param('id') id: string,
    @Body() updates: UpdateWebhookEndpointDto,
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

  // ---------------------------------------------------------------------------
  // DELETE /webhooks/endpoints/:id
  // ---------------------------------------------------------------------------

  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  @ApiParam({ name: 'id', description: 'Webhook endpoint ID', example: 'endpoint-uuid' })
  @ApiResponse({
    status: 204,
    description: 'Endpoint deleted successfully (no body returned)',
  })
  @ApiResponse({
    status: 404,
    description: 'Endpoint not found',
    example: {
      statusCode: 404,
      message: 'Webhook endpoint not found',
      error: 'Not Found',
    },
  })
  @Delete('endpoints/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteEndpoint(@Param('id') id: string) {
    await this.webhookService.deleteEndpoint(id);
  }

  // ---------------------------------------------------------------------------
  // POST /webhooks/endpoints/:id/rotate-secret
  // ---------------------------------------------------------------------------

  @ApiOperation({
    summary: 'Rotate the webhook signing secret',
    description:
      'Generates a new HMAC-SHA256 signing secret for the endpoint. ' +
      'The new secret is **only returned once** in this response — store it immediately.',
  })
  @ApiParam({ name: 'id', description: 'Webhook endpoint ID', example: 'endpoint-uuid' })
  @ApiResponse({
    status: 200,
    description: 'New secret returned. This is the only time it will be visible.',
    example: {
      secret: 'whsec_newSecretValue123...',
      rotatedAt: '2024-06-24T15:00:00.000Z',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Endpoint not found',
    example: {
      statusCode: 404,
      message: 'Webhook endpoint not found',
      error: 'Not Found',
    },
  })
  @Post('endpoints/:id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  async rotateSecret(@Param('id') id: string) {
    const result = await this.webhookService.rotateSecret(id);

    return {
      secret: result.secret, // Only time the new secret is returned!
      rotatedAt: new Date(),
    };
  }

  // ---------------------------------------------------------------------------
  // GET /webhooks/endpoints/:id/deliveries
  // ---------------------------------------------------------------------------

  @ApiOperation({ summary: 'Get delivery history for a webhook endpoint' })
  @ApiParam({ name: 'id', description: 'Webhook endpoint ID', example: 'endpoint-uuid' })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number (starting from 1)' })
  @ApiQuery({ name: 'limit', required: false, example: 50, description: 'Items per page (max 100)' })
  @ApiResponse({
    status: 200,
    description: 'Paginated delivery history',
    example: {
      endpointId: 'endpoint-uuid',
      page: 1,
      limit: 50,
      total: 3,
      deliveries: [
        {
          id: 'delivery-uuid',
          eventId: 'event-uuid',
          eventType: 'wallet.created',
          status: 'DELIVERED',
          attempts: 1,
          maxAttempts: 5,
          responseStatus: 200,
          responseTime: 142,
          nextRetryAt: null,
          firstAttemptAt: '2024-06-24T12:01:00.000Z',
          lastAttemptAt: '2024-06-24T12:01:00.000Z',
          deliveredAt: '2024-06-24T12:01:00.000Z',
          errorMessage: null,
          createdAt: '2024-06-24T12:00:00.000Z',
        },
      ],
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Endpoint not found',
    example: {
      statusCode: 404,
      message: 'Webhook endpoint not found',
      error: 'Not Found',
    },
  })
  @Get('endpoints/:id/deliveries')
  async getDeliveries(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Math.max(1, parseInt(page || '1', 10));
    const pageLimit = Math.min(100, Math.max(1, parseInt(limit || '50', 10)));

    const result = await this.webhookService.getDeliveries(
      id,
      pageNumber,
      pageLimit,
    );

    return {
      endpointId: id,
      page: pageNumber,
      limit: pageLimit,
      total: result.total,
      deliveries: result.deliveries.map((d) => ({
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
    };
  }

  // ---------------------------------------------------------------------------
  // POST /webhooks/process-deliveries
  // ---------------------------------------------------------------------------

  @ApiOperation({
    summary: 'Manually trigger webhook delivery processing (admin)',
    description:
      'Picks up all pending and retrying webhook deliveries and attempts to dispatch them. ' +
      'Intended for admin use or recovery from processing backlogs.',
  })
  @ApiResponse({
    status: 200,
    description: 'Processing complete — summary of delivery outcomes',
    example: {
      processed: 5,
      delivered: 3,
      failed: 1,
      retrying: 1,
    },
  })
  @Post('process-deliveries')
  @HttpCode(HttpStatus.OK)
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
