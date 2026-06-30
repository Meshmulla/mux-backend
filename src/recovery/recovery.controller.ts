import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiParam,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { RecoveryService } from './recovery.service';
import { CreateRecoveryDto } from './dto/create-recovery.dto';
import { UpdateRecoveryDto } from './dto/update-recovery.dto';
import { RecoveryStatus } from './domain/recovery.model';

@ApiTags('recovery')
@Controller('recovery')
export class RecoveryController {
  constructor(private readonly recoveryService: RecoveryService) {}

  @ApiOperation({
    summary: 'Create a recovery request',
    description:
      'Create a new recovery request for a wallet. An active recovery request already exists for the same wallet will be rejected.',
  })
  @ApiBody({
    type: CreateRecoveryDto,
    examples: {
      default: {
        summary: 'Standard recovery request',
        value: {
          walletId: '550e8400-e29b-41d4-a716-446655440000',
          requester: 'user_abc123',
          metadata: {
            reason: 'lost_access',
            contactEmail: 'user@example.com',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Recovery request created successfully',
    schema: {
      example: {
        id: '660e8400-e29b-41d4-a716-446655440001',
        walletId: '550e8400-e29b-41d4-a716-446655440000',
        requester: 'user_abc123',
        status: 'PENDING',
        metadata: {
          reason: 'lost_access',
          contactEmail: 'user@example.com',
        },
        createdAt: '2026-06-29T12:00:00.000Z',
        updatedAt: '2026-06-29T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input, wallet not found, or active recovery exists',
    schema: {
      example: {
        statusCode: 400,
        message: ['walletId must be a UUID', 'requester must be a string'],
        error: 'Bad Request',
      },
    },
  })
  @Post()
  create(@Body() createRecoveryDto: CreateRecoveryDto) {
    return this.recoveryService.create(createRecoveryDto);
  }

  @ApiOperation({
    summary: 'List recovery requests with optional filters and pagination',
    description:
      'Retrieve a paginated list of recovery requests. Supports filtering by wallet ID, requester, and status.',
  })
  @ApiQuery({
    name: 'walletId',
    required: false,
    description: 'Filter by wallet ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'requester',
    required: false,
    description: 'Filter by requester (partial match, case-insensitive)',
    example: 'user_abc',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: RecoveryStatus,
    description: 'Filter by recovery status',
    example: 'PENDING',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max records to return (1-100, default 20)',
    example: 20,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description: 'Number of records to skip (default 0)',
    example: 0,
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of recovery requests',
    schema: {
      example: {
        data: [
          {
            id: '660e8400-e29b-41d4-a716-446655440001',
            walletId: '550e8400-e29b-41d4-a716-446655440000',
            requester: 'user_abc123',
            status: 'PENDING',
            metadata: { reason: 'lost_access' },
            createdAt: '2026-06-29T12:00:00.000Z',
            updatedAt: '2026-06-29T12:00:00.000Z',
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid pagination parameters',
    schema: {
      example: {
        statusCode: 400,
        message: 'limit must not exceed 100',
        error: 'Bad Request',
      },
    },
  })
  @Get()
  findAll() {
    return this.recoveryService.findAll();
  }

  @ApiOperation({
    summary: 'Get a recovery request by ID',
    description: 'Retrieve a single recovery request by its UUID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Recovery request UUID',
    example: '660e8400-e29b-41d4-a716-446655440001',
  })
  @ApiResponse({
    status: 200,
    description: 'Recovery request found',
    schema: {
      example: {
        id: '660e8400-e29b-41d4-a716-446655440001',
        walletId: '550e8400-e29b-41d4-a716-446655440000',
        requester: 'user_abc123',
        status: 'PENDING',
        metadata: { reason: 'lost_access' },
        createdAt: '2026-06-29T12:00:00.000Z',
        updatedAt: '2026-06-29T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Recovery request not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'Recovery request not found',
        error: 'Not Found',
      },
    },
  })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.recoveryService.findOne(id);
  }

  @ApiOperation({
    summary: 'Update a recovery request status',
    description:
      'Update a recovery request status. Valid transitions: PENDING→IN_REVIEW, PENDING→CANCELLED, IN_REVIEW→APPROVED, IN_REVIEW→REJECTED, IN_REVIEW→CANCELLED, APPROVED→COMPLETED, APPROVED→CANCELLED.',
  })
  @ApiParam({
    name: 'id',
    description: 'Recovery request UUID',
    example: '660e8400-e29b-41d4-a716-446655440001',
  })
  @ApiBody({
    type: UpdateRecoveryDto,
    examples: {
      review: {
        summary: 'Move to IN_REVIEW',
        value: { status: 'IN_REVIEW' },
      },
      approve: {
        summary: 'Approve recovery',
        value: { status: 'APPROVED' },
      },
      reject: {
        summary: 'Reject recovery',
        value: { status: 'REJECTED' },
      },
      complete: {
        summary: 'Complete recovery',
        value: { status: 'COMPLETED' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Recovery request updated',
    schema: {
      example: {
        id: '660e8400-e29b-41d4-a716-446655440001',
        walletId: '550e8400-e29b-41d4-a716-446655440000',
        requester: 'user_abc123',
        status: 'IN_REVIEW',
        metadata: { reason: 'lost_access' },
        createdAt: '2026-06-29T12:00:00.000Z',
        updatedAt: '2026-06-29T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid status transition',
    schema: {
      example: {
        statusCode: 400,
        message: 'Invalid recovery status transition: COMPLETED -> PENDING',
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Recovery request not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'Recovery request not found',
        error: 'Not Found',
      },
    },
  })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateRecoveryDto: UpdateRecoveryDto,
  ) {
    return this.recoveryService.update(id, updateRecoveryDto);
  }

  @ApiOperation({
    summary: 'Delete a recovery request',
    description: 'Permanently delete a recovery request by ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Recovery request UUID',
    example: '660e8400-e29b-41d4-a716-446655440001',
  })
  @ApiResponse({
    status: 200,
    description: 'Recovery request deleted successfully',
    schema: {
      example: { message: 'Recovery request deleted successfully' },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Recovery request not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'Recovery request not found',
        error: 'Not Found',
      },
    },
  })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.recoveryService.remove(id);
  }
}
