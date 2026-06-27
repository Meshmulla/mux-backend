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
import { WebhookFilterDto } from './dto/webhook-filter.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('webhooks')
@Controller('webhooks')
@UseGuards(FeatureFlagGuard)
@FeatureFlag('webhooks_enabled')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly webhookDispatcher: WebhookDispatcherService,
  ) { }

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
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Math.max(1, parseInt(page || '1', 10));
    const pageLimit = Math.min(
      100,
      Math.max(1, parseInt(limit || '20', 10)),
    );

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
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

    // Don't return secrets in list
    return {
  endpoints: endpoints.map((e) => ({
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

/**
 * Gets a specific webhook endpoint
 */
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
    // Note: Secret not returned in GET
  };
}

/**
 * Updates a webhook endpoint
 */
@Put('endpoints/:id')
@HttpCode(HttpStatus.OK)
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
 */
@Delete('endpoints/:id')
@HttpCode(HttpStatus.NO_CONTENT)
async deleteEndpoint(@Param('id') id: string) {
  await this.webhookService.deleteEndpoint(id);
}

/**
 * Rotates the webhook signing secret
 */
@Post('endpoints/:id/rotate-secret')
@HttpCode(HttpStatus.OK)
async rotateSecret(@Param('id') id: string) {
  const result = await this.webhookService.rotateSecret(id);

  return {
    secret: result.secret, // Only time new secret is returned!
    rotatedAt: new Date(),
  };
}

/**
 * Gets delivery history for an endpoint
 */
@Get('endpoints/:id/deliveries')
async getDeliveries(
  @Param('id') id: string,
  @Query('page') page ?: string,
  @Query('limit') limit ?: string,
) {
  const pageNumber = Math.max(1, parseInt(page || '1', 10));

  const pageLimit = Math.min(
    100,
    Math.max(1, parseInt(limit || '50', 10)),
  );

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

/**
 * Manually triggers webhook delivery processing (admin only)
 */
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
