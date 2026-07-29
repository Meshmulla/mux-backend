import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { ApiKeyCtx } from '../api-keys/decorators/api-key-context.decorator';
import { ApiKeyContext } from '../api-keys/domain/api-key.model';
import {
  RateLimitGuard,
  SensitiveEndpoint,
} from '../rate-limit/rate-limit.guard';
import {
  FeatureFlagGuard,
  FeatureFlag,
} from '../common/feature-flags/feature-flag.guard';
import {
  TenantScopeGuard,
  TenantScoped,
} from '../common/guards/tenant-scope.guard';
import {
  TransactionExportService,
  ExportFormat,
  ExportFilters,
} from './transaction-export.service';

class CreateExportJobDto {
  /** Export format: CSV (default) or JSON */
  format?: ExportFormat;

  /** Optional filters to narrow the export scope */
  filters?: ExportFilters;
}

@ApiTags('transactions')
@Controller('transactions/export')
@UseGuards(ApiKeyGuard, RateLimitGuard, FeatureFlagGuard, TenantScopeGuard)
@FeatureFlag('transactions_enabled')
export class TransactionExportController {
  constructor(private readonly exportService: TransactionExportService) {}

  // ---------------------------------------------------------------------------
  // POST /transactions/export
  // ---------------------------------------------------------------------------

  @ApiOperation({
    summary: 'Start an async transaction export job',
    description:
      'Creates an export job and begins processing in the background. ' +
      'The job is scoped to the authenticated project. ' +
      'Poll GET /transactions/export/:jobId for status and download link.',
  })
  @ApiBody({
    schema: {
      example: {
        format: 'CSV',
        filters: {
          status: 'CONFIRMED',
          createdAfter: '2026-01-01T00:00:00.000Z',
          createdBefore: '2026-07-01T00:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Export job accepted — poll the returned jobId for status',
    schema: {
      example: {
        jobId: 'uuid',
        status: 'PENDING',
        format: 'CSV',
        createdAt: '2026-07-27T05:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid format or filter values' })
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @SensitiveEndpoint()
  async createExportJob(
    @Body() dto: CreateExportJobDto,
    @ApiKeyCtx() ctx: ApiKeyContext,
  ) {
    const job = await this.exportService.createExportJob({
      projectId: ctx.project.id,
      requestedBy: ctx.apiKey.id,
      format: dto.format ?? 'CSV',
      filters: dto.filters,
    });

    return {
      jobId: job.id,
      projectId: job.projectId,
      format: job.format,
      status: job.status,
      createdAt: job.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /transactions/export/jobs — list jobs for the authenticated project
  // ---------------------------------------------------------------------------

  @ApiOperation({
    summary: 'List export jobs for the authenticated project',
  })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        jobs: [
          {
            id: 'uuid',
            format: 'CSV',
            status: 'COMPLETED',
            rowCount: 1423,
            downloadUrl: 'data:text/csv;base64,...',
            expiresAt: '2026-07-28T05:00:00.000Z',
            createdAt: '2026-07-27T05:00:00.000Z',
          },
        ],
        total: 1,
      },
    },
  })
  @Get('jobs')
  async listExportJobs(
    @ApiKeyCtx() ctx: ApiKeyContext,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitN = limit !== undefined ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 20;
    const offsetN = offset !== undefined ? Math.max(0, parseInt(offset, 10)) : 0;

    if (isNaN(limitN) || isNaN(offsetN)) {
      throw new BadRequestException('limit and offset must be integers');
    }

    const result = await this.exportService.listExportJobs(
      ctx.project.id,
      limitN,
      offsetN,
    );

    return {
      jobs: result.jobs.map((j) => ({
        id: j.id,
        format: j.format,
        status: j.status,
        rowCount: j.rowCount,
        downloadUrl: j.downloadUrl,
        expiresAt: j.expiresAt,
        errorMessage: j.errorMessage,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
        createdAt: j.createdAt,
      })),
      total: result.total,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /transactions/export/:jobId — poll job status
  // ---------------------------------------------------------------------------

  @ApiOperation({
    summary: 'Get the status of a transaction export job',
    description:
      'Returns current job status. When status is COMPLETED, the `downloadUrl` ' +
      'field contains the export data as a base64-encoded data URI. ' +
      'The link is valid for 24 hours after completion.',
  })
  @ApiParam({ name: 'jobId', description: 'Export job ID returned by POST /transactions/export' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        id: 'uuid',
        projectId: 'proj-uuid',
        format: 'CSV',
        status: 'COMPLETED',
        rowCount: 1423,
        downloadUrl: 'data:text/csv;base64,...',
        expiresAt: '2026-07-28T05:00:00.000Z',
        errorMessage: null,
        startedAt: '2026-07-27T05:00:01.000Z',
        completedAt: '2026-07-27T05:00:03.000Z',
        createdAt: '2026-07-27T05:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Export job not found for this project' })
  @Get(':jobId')
  async getExportJob(
    @Param('jobId') jobId: string,
    @ApiKeyCtx() ctx: ApiKeyContext,
  ) {
    const job = await this.exportService.getExportJob(jobId, ctx.project.id);

    return {
      id: job.id,
      projectId: job.projectId,
      format: job.format,
      status: job.status,
      rowCount: job.rowCount,
      downloadUrl: job.downloadUrl,
      expiresAt: job.expiresAt,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
    };
  }
}
