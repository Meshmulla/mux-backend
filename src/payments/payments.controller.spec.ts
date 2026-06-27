import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { PaymentStatus } from './entities/payment.entity';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: { update: jest.Mock } & Record<string, jest.Mock>;

  beforeEach(async () => {
    paymentsService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsService, useValue: paymentsService }],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PaymentsController>(PaymentsController);
    jest.clearAllMocks();
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('update', () => {
    it('should delegate to service and return updated payment', async () => {
      const updated = { id: 1, status: PaymentStatus.CONFIRMED };
      paymentsService.update.mockResolvedValue(updated);

      const result = await controller.update('1', {
        status: PaymentStatus.CONFIRMED,
      });

      expect(paymentsService.update).toHaveBeenCalledWith('1', {
        status: PaymentStatus.CONFIRMED,
      });
      expect(result).toEqual(updated);
    });

    it('should propagate NotFoundException from service', async () => {
      paymentsService.update.mockRejectedValue(
        new NotFoundException('Payment #99 not found'),
      );

      await expect(
        controller.update('99', { status: PaymentStatus.CONFIRMED }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate BadRequestException from service', async () => {
      paymentsService.update.mockRejectedValue(
        new BadRequestException(
          'Cannot transition payment from CONFIRMED to FAILED',
        ),
      );

      await expect(
        controller.update('1', { status: PaymentStatus.FAILED }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('swagger decorators', () => {
    it('should have @ApiResponse decorators on all routes', () => {
      const routes = ['create', 'findAll', 'findOne', 'update', 'remove'];

      routes.forEach((route) => {
        const descriptor = Object.getOwnPropertyDescriptor(
          PaymentsController.prototype,
          route,
        );
        expect(descriptor).toBeDefined();

        const metadata = Reflect.getMetadata('swagger/apiResponse', descriptor.value);
        expect(metadata).toBeDefined();
      });
    });
  });
});
