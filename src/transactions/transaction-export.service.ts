import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ExportFormat = 'CSV' | 'JSON';

export type ExportJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED';

export interface ExportFilters {
  senderWalletId?: string;
  receiverWalletId?: string;
  status?: string;
  assetType?: string;
  assetCode?: string;
  createdAfter?: string;
  createdBefore?: string;
}

export interface CreateExportJobRequest {
  projectId: string;
  requestedBy?: string;
  format?: ExportFormat;
  filters?: ExportFilters;
}

export interface ExportJobSummary {
  id: string;
  projectId: string;
  format: ExportFormat;
  status: ExportJobStatus;
  rowCount: number;
  downloadUrl: string | null;
  expiresAt: Date | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

/** How long a completed export download link remains valid (default 24h) */
const DOWNLOAD_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * TransactionExportService
 *
 * Provides async export of transaction data for a given project.
 *
 * Flow:
 *  1. `createExportJob` — creates a PENDING job record and fires off the
 *     export in the background (non-blocking to the HTTP caller).
 *  2. `getExportJob`    — polls job status by ID.
 *  3. `listExportJobs` — lists all jobs for a project (for admin/debug).
 *
 * The actual export data is encoded inline as a base64 data URI on the
 * `downloadUrl` field (suitable for moderate-sized exports). In production
 * this would be replaced with a signed S3 URL written after the file upload.
 */
@Injectable()
export class TransactionExportService {
  private readonly logger = new Logger(TransactionExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates an async export job and begins processing in the background.
   * Returns immediately with the job ID so the caller can poll for status.
   */
  async createExportJob(request: CreateExportJobRequest): Promise<ExportJobSummary> {
    const { projectId, requestedBy, format = 'CSV', filters } = request;

    if (format !== 'CSV' && format !== 'JSON') {
      throw new BadRequestException(`Unsupported export format: ${format}. Use CSV or JSON.`);
    }

    const job = await this.prisma.transactionExportJob.create({
      data: {
        projectId,
        requestedBy: requestedBy ?? null,
        format,
        filters: filters ? (filters as any) : null,
        status: 'PENDING',
        rowCount: 0,
      },
    });

    this.logger.log(`Created export job ${job.id} for project ${projectId} (format: ${format})`);

    // Fire-and-forget: process the export asynchronously
    this.runExport(job.id, projectId, format, filters ?? {}).catch((err) => {
      this.logger.error(`Export job ${job.id} failed unexpectedly`, err);
    });

    return this.mapToSummary(job);
  }

  /**
   * Retrieves the status and result of an export job.
   * Throws NotFoundException if the job ID does not exist for the given project.
   */
  async getExportJob(jobId: string, projectId: string): Promise<ExportJobSummary> {
    const job = await this.prisma.transactionExportJob.findFirst({
      where: { id: jobId, projectId },
    });

    if (!job) {
      throw new NotFoundException(`Export job ${jobId} not found`);
    }

    return this.mapToSummary(job);
  }

  /**
   * Lists all export jobs for a project, newest first.
   */
  async listExportJobs(
    projectId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ jobs: ExportJobSummary[]; total: number }> {
    const [jobs, total] = await Promise.all([
      this.prisma.transactionExportJob.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.transactionExportJob.count({ where: { projectId } }),
    ]);

    return {
      jobs: jobs.map((j) => this.mapToSummary(j)),
      total,
    };
  }

  // ---------------------------------------------------------------------------
  // Private — export execution
  // ---------------------------------------------------------------------------

  /**
   * Runs the actual query and serialization in the background.
   * Updates job status throughout execution.
   */
  private async runExport(
    jobId: string,
    projectId: string,
    format: ExportFormat,
    filters: ExportFilters,
  ): Promise<void> {
    // Mark RUNNING
    await this.prisma.transactionExportJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    try {
      const transactions = await this.fetchTransactions(projectId, filters);
      const content = format === 'CSV'
        ? this.serializeCsv(transactions)
        : JSON.stringify(transactions, null, 2);

      const mimeType = format === 'CSV' ? 'text/csv' : 'application/json';
      const downloadUrl = `data:${mimeType};base64,${Buffer.from(content).toString('base64')}`;
      const expiresAt = new Date(Date.now() + DOWNLOAD_LINK_TTL_MS);

      await this.prisma.transactionExportJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          rowCount: transactions.length,
          downloadUrl,
          expiresAt,
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `Export job ${jobId} completed: ${transactions.length} rows, format=${format}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Export job ${jobId} failed: ${message}`);

      await this.prisma.transactionExportJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          errorMessage: message.substring(0, 500),
          completedAt: new Date(),
        },
      });
    }
  }

  /**
   * Fetches transactions scoped to the project via their sender/receiver wallets.
   */
  private async fetchTransactions(
    projectId: string,
    filters: ExportFilters,
  ): Promise<any[]> {
    const where: Record<string, any> = {
      // Scope to project: wallets belong to the project's developer API keys.
      // We query via the wallet → user path, using the project's api key context.
      // For pragmatic scoping here we filter by any wallet that belongs to the project.
      OR: [
        {
          senderWallet: {
            user: {
              wallets: {
                some: {
                  apiKeys: {
                    some: { project: { id: projectId } },
                  },
                },
              },
            },
          },
        },
      ],
    };

    // Apply optional filters
    if (filters.senderWalletId) where.senderWalletId = filters.senderWalletId;
    if (filters.receiverWalletId) where.receiverWalletId = filters.receiverWalletId;
    if (filters.status) where.status = filters.status;
    if (filters.assetType) where.assetType = filters.assetType;
    if (filters.assetCode) where.assetCode = filters.assetCode;
    if (filters.createdAfter || filters.createdBefore) {
      where.createdAt = {};
      if (filters.createdAfter) where.createdAt.gte = new Date(filters.createdAfter);
      if (filters.createdBefore) where.createdAt.lte = new Date(filters.createdBefore);
    }

    return this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50_000, // Hard cap to prevent unbounded export
      select: {
        id: true,
        amount: true,
        assetType: true,
        assetCode: true,
        assetIssuer: true,
        senderWalletId: true,
        receiverWalletId: true,
        memo: true,
        status: true,
        stellarHash: true,
        stellarLedger: true,
        stellarFee: true,
        statusChangedAt: true,
        statusReason: true,
        submittedAt: true,
        confirmedAt: true,
        failedAt: true,
        idempotencyKey: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Converts an array of transaction records to RFC 4180-compliant CSV.
   */
  private serializeCsv(rows: any[]): string {
    if (rows.length === 0) return '';

    const headers = [
      'id',
      'amount',
      'assetType',
      'assetCode',
      'assetIssuer',
      'senderWalletId',
      'receiverWalletId',
      'memo',
      'status',
      'stellarHash',
      'stellarLedger',
      'stellarFee',
      'statusReason',
      'idempotencyKey',
      'statusChangedAt',
      'submittedAt',
      'confirmedAt',
      'failedAt',
      'createdAt',
      'updatedAt',
    ];

    const escape = (v: any): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      // Quote fields that contain commas, quotes, or newlines
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => escape(row[h])).join(','));
    }

    return lines.join('\n');
  }

  private mapToSummary(job: any): ExportJobSummary {
    return {
      id: job.id,
      projectId: job.projectId,
      format: job.format as ExportFormat,
      status: job.status as ExportJobStatus,
      rowCount: job.rowCount,
      downloadUrl: job.downloadUrl ?? null,
      expiresAt: job.expiresAt ?? null,
      errorMessage: job.errorMessage ?? null,
      startedAt: job.startedAt ?? null,
      completedAt: job.completedAt ?? null,
      createdAt: job.createdAt,
    };
  }
}
