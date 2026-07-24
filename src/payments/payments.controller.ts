import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PaymentsFilterDto } from './dto/payments-filter.dto';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import {
  RateLimitGuard,
  SensitiveEndpoint,
} from '../rate-limit/rate-limit.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  FeatureFlagGuard,
  FeatureFlag,
} from '../common/feature-flags/feature-flag.guard';

@ApiTags('payments')
@Controller('payments')
@UseGuards(ApiKeyGuard, RateLimitGuard, FeatureFlagGuard)
@FeatureFlag('payments_api')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiOperation({
    summary: 'Create a new payment',
    description: 'Create a new payment between wallets. Requires API key authentication. Rate limited to prevent abuse. Emits payment.created event on success. Pass an idempotencyKey to safely retry without creating a duplicate payment — replaying the same key returns the original payment.',
  })
  @ApiBody({
    type: CreatePaymentDto,
    examples: {
      default: {
        value: {
          walletId: '123e4567-e89b-12d3-a456-426614174000',
          receiverWalletId: '123e4567-e89b-12d3-a456-426614174001',
          amount: 100.5,
          currency: 'USD',
          description: 'Payment for services',
          fromId: 1,
          toId: 2,
          idempotencyKey: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Payment created successfully. Emits payment.created domain event.',
    example: {
      id: 1,
      amount: 100.5,
      currency: 'USD',
      status: 'PENDING',
      description: 'Payment for services',
      fromId: 1,
      toId: 2,
      userId: 1,
      createdAt: '2024-06-24T12:34:56.789Z',
      updatedAt: '2024-06-24T12:34:56.789Z',
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input',
    example: {
      statusCode: 400,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/payments',
      method: 'POST',
      message: ['amount must be positive'],
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - missing or invalid API key',
    example: {
      statusCode: 401,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/payments',
      method: 'POST',
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  })
  @Post()
  @SensitiveEndpoint()
  create(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.create(createPaymentDto);
  }

  @ApiOperation({
    summary: 'List all payments with pagination and filtering',
    description: 'Retrieve paginated list of payments. Requires API key authentication. Supports filtering by status.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number (starting from 1)' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Items per page (max 100)' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'CONFIRMED', 'FAILED'], description: 'Filter by payment status' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of payments',
    example: {
      data: [
        {
          id: 1,
          amount: 100.5,
          currency: 'USD',
          status: 'PENDING',
          description: 'Payment for services',
          fromId: 1,
          toId: 2,
          userId: 1,
          createdAt: '2024-06-24T12:34:56.789Z',
          updatedAt: '2024-06-24T12:34:56.789Z',
        },
      ],
      total: 100,
      page: 1,
      limit: 20,
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid pagination or filter params',
    example: {
      statusCode: 400,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/payments?limit=200',
      method: 'GET',
      message: 'limit must not exceed 100',
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - missing or invalid API key',
    example: {
      statusCode: 401,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/payments',
      method: 'GET',
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  })
  @Get()
  findAll(
    @Query() pagination: PaginationDto,
    @Query() filters: PaymentsFilterDto,
  ) {
    return this.paymentsService.findAll(pagination, filters);
  }

  @ApiOperation({
    summary: 'Get a single payment by ID',
    description: 'Retrieve a specific payment. Requires API key authentication.',
  })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiResponse({
    status: 200,
    description: 'Payment found',
    example: {
      id: 1,
      amount: 100.5,
      currency: 'USD',
      status: 'PENDING',
      description: 'Payment for services',
      fromId: 1,
      toId: 2,
      userId: 1,
      createdAt: '2024-06-24T12:34:56.789Z',
      updatedAt: '2024-06-24T12:34:56.789Z',
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - missing or invalid API key',
    example: {
      statusCode: 401,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/payments/1',
      method: 'GET',
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Payment not found',
    example: {
      statusCode: 404,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/payments/999',
      method: 'GET',
      message: 'Payment #999 not found',
      error: 'Not Found',
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded',
    example: {
      statusCode: 429,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/payments',
      method: 'POST',
      message: 'Too many requests',
      error: 'Too Many Requests',
    },
  })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  @ApiOperation({
    summary: 'Update a payment',
    description: 'Update payment status or description. Valid status transitions: PENDING→CONFIRMED, PENDING→FAILED. Emits payment.completed or payment.failed event on status transition. Requires API key authentication.',
  })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiBody({
    type: UpdatePaymentDto,
    examples: {
      default: {
        value: {
          status: 'CONFIRMED',
          description: 'Updated description',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Payment updated successfully. Emits payment.completed or payment.failed event if status changed.',
    example: {
      id: 1,
      amount: 100.5,
      currency: 'USD',
      status: 'CONFIRMED',
      description: 'Updated description',
      fromId: 1,
      toId: 2,
      userId: 1,
      createdAt: '2024-06-24T12:34:56.789Z',
      updatedAt: '2024-06-24T12:35:00.000Z',
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid status transition',
    example: {
      statusCode: 400,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/payments/1',
      method: 'PATCH',
      message: 'Cannot transition payment from CONFIRMED to PENDING',
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - missing or invalid API key',
    example: {
      statusCode: 401,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/payments/1',
      method: 'PATCH',
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Payment not found',
    example: {
      statusCode: 404,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/payments/999',
      method: 'PATCH',
      message: 'Payment #999 not found',
      error: 'Not Found',
    },
  })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePaymentDto: UpdatePaymentDto) {
    return this.paymentsService.update(id, updatePaymentDto);
  }

  @ApiOperation({
    summary: 'Delete a payment',
    description: 'Delete a payment. Requires API key authentication.',
  })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiResponse({
    status: 200,
    description: 'Payment deleted successfully',
    example: {
      message: 'This action removes payment 1',
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - missing or invalid API key',
    example: {
      statusCode: 401,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/payments/1',
      method: 'DELETE',
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.paymentsService.remove(id);
  }
}
