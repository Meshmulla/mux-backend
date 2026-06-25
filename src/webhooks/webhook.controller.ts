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
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';
import { WebhookFilterDto } from './dto/webhook-filter.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly webhookDispatcher: WebhookDispatcherService,
  ) {}

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
    description: 'Bad request - invalid input',
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

  @ApiOperation({ summary: 'List webhook endpoints for a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
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
    @Query() filters: WebhookFilterDto,
  ) {
    const result = await this.webhookService.listEndpoints(projectId, filters);

    return {
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
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  @ApiOperation({ summary: 'Get a webhook endpoint by ID' })
  @ApiParam({ name: 'id', description: 'Webhook endpoint ID' })
  @ApiResponse({
    status: 200,
    description: 'Webhook endpoint details. Secret is never returned in GET.',
    example: {
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
  })
  @ApiResponse({
    status: 404,
    description: 'Webhook endpoint not found',
    example: {
      statusCode: 404,
      message: 'Webhook endpoint endpoint-uuid not found',
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
    };
  }

  @ApiOperation({ summary: 'Update a webhook endpoint' })
  @ApiParam({ name: 'id', description: 'Webhook endpoint ID' })
  @ApiBody({
    type: UpdateWebhookEndpointDto,
    examples: {
      default: {
        value: {
          url: 'https://example.com/new-webhook',
          events: ['wallet.created', 'balance.updated'],
          status: 'ACTIVE',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook endpoint updated',
    example: {
      id: 'endpoint-uuid',
      url: 'https://example.com/new-webhook',
      events: ['wallet.created', 'balance.updated'],
      description: 'My webhook',
      status: 'ACTIVE',
      updatedAt: '2024-06-24T12:05:00.000Z',
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input',
    example: {
      statusCode: 400,
      message: ['url must be a valid URL'],
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Webhook endpoint not found',
    example: {
      statusCode: 404,
      message: 'Webhook endpoint endpoint-uuid not found',
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

  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  @ApiParam({ name: 'id', description: 'Webhook endpoint ID' })
  @ApiResponse({ status: 204, description: 'Webhook endpoint deleted' })
  @ApiResponse({
    status: 404,
    description: 'Webhook endpoint not found',
    example: {
      statusCode: 404,
      message: 'Webhook endpoint endpoint-uuid not found',
      error: 'Not Found',
    },
  })
  @Delete('endpoints/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteEndpoint(@Param('id') id: string) {
    await this.webhookService.deleteEndpoint(id);
  }

  @ApiOperation({
    summary: 'Rotate the signing secret for a webhook endpoint',
    description:
      'Generates a new HMAC signing secret. The new secret is returned only in this response — ' +
      'update your receiver immediately. Requests signed with the old secret will fail after rotation.',
  })
  @ApiParam({ name: 'id', description: 'Webhook endpoint ID' })
  @ApiResponse({
    status: 200,
    description: 'New secret. This is the only time it is returned.',
    example: {
      secret: 'whsec_newSecret...',
      rotatedAt: '2024-06-24T12:10:00.000Z',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Webhook endpoint not found',
    example: {
      statusCode: 404,
      message: 'Webhook endpoint endpoint-uuid not found',
      error: 'Not Found',
    },
  })
  @Post('endpoints/:id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  async rotateSecret(@Param('id') id: string) {
    const result = await this.webhookService.rotateSecret(id);

    return {
      secret: result.secret,
      rotatedAt: new Date(),
    };
  }

  @ApiOperation({ summary: 'Get paginated delivery history for a webhook endpoint' })
  @ApiParam({ name: 'id', description: 'Webhook endpoint ID' })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number (starting from 1)' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Items per page (max 100)' })
  @ApiResponse({
    status: 200,
    description: 'Paginated delivery history',
    example: {
      endpointId: 'endpoint-uuid',
      deliveries: [
        {
          id: 'delivery-uuid',
          eventId: 'event-uuid',
          eventType: 'wallet.created',
          status: 'DELIVERED',
          attempts: 1,
          maxAttempts: 5,
          responseStatus: 200,
          responseTime: 145,
          nextRetryAt: null,
          firstAttemptAt: '2024-06-24T12:00:00.000Z',
          lastAttemptAt: '2024-06-24T12:00:00.000Z',
          deliveredAt: '2024-06-24T12:00:00.000Z',
          errorMessage: null,
          createdAt: '2024-06-24T12:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid pagination params',
    example: {
      statusCode: 400,
      message: ['page must be at least 1', 'limit must not exceed 100'],
      error: 'Bad Request',
    },
  })
  @Get('endpoints/:id/deliveries')
  async getDeliveries(
    @Param('id') id: string,
    @Query() pagination: PaginationDto,
  ) {
    const result = await this.webhookService.getDeliveries(
      id,
      pagination.page,
      pagination.limit,
    );

    return {
      endpointId: id,
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
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  @ApiOperation({
    summary: 'Trigger webhook delivery processing',
    description: 'Admin endpoint to manually trigger processing of pending and retrying deliveries.',
  })
  @ApiResponse({
    status: 200,
    description: 'Processing summary',
    example: {
      processed: 5,
      delivered: 4,
      failed: 0,
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
