import requestLogger from './request-logging.middleware';
import { Logger } from '@nestjs/common';
import { RequestContextService } from '../request-context/request-context.service';

describe('requestLogger', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('sets x-request-id, logs and calls next', () => {
    const req: any = {
      method: 'GET',
      originalUrl: '/test',
      headers: {},
      ip: '1.2.3.4',
    };
    const finishCallbacks: Record<string, Function[]> = { finish: [] };
    const res: any = {
      setHeader: jest.fn(),
      on: (event: string, cb: Function) => {
        finishCallbacks[event].push(cb);
      },
      statusCode: 200,
    };
    const next = jest.fn();

    const spyLog = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});

    requestLogger(req, res, next as any);

    expect(res.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      expect.any(String),
    );
    expect(next).toHaveBeenCalled();
    expect(spyLog).toHaveBeenCalled();

    // simulate finish handlers
    finishCallbacks.finish.forEach((cb) => cb());
    expect(spyLog).toHaveBeenCalled();
  });

  it('preserves an incoming x-request-id header', () => {
    const req: any = {
      method: 'POST',
      originalUrl: '/test',
      headers: { 'x-request-id': 'req-123' },
      ip: '1.2.3.4',
    };
    const res: any = {
      setHeader: jest.fn(),
      on: jest.fn(),
      statusCode: 200,
    };
    const next = jest.fn();

    requestLogger(req, res, next as any);

    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'req-123');
    expect(next).toHaveBeenCalled();
  });

  it('handles invalid/stale request objects gracefully', () => {
    const req: any = null;
    const res: any = { setHeader: jest.fn(), on: jest.fn() };
    const next = jest.fn();

    const spyWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    requestLogger(req, res, next as any);

    expect(next).toHaveBeenCalled();
    expect(spyWarn).toHaveBeenCalled();
  });

  it('attaches request ID to request object', () => {
    const req: any = {
      method: 'GET',
      originalUrl: '/test',
      headers: {},
      ip: '1.2.3.4',
    };
    const finishCallbacks: Record<string, Function[]> = { finish: [] };
    const res: any = {
      setHeader: jest.fn(),
      on: (event: string, cb: Function) => {
        finishCallbacks[event].push(cb);
      },
      statusCode: 200,
    };
    const next = jest.fn();

    jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});

    requestLogger(req, res, next as any);

    expect(req.requestId).toBeDefined();
    expect(typeof req.requestId).toBe('string');
    expect(req.requestId.length).toBeGreaterThan(0);
  });

  it('forwards existing x-request-id header to request object', () => {
    const existingId = 'existing-request-id-123';
    const req: any = {
      method: 'GET',
      originalUrl: '/test',
      headers: { 'x-request-id': existingId },
      ip: '1.2.3.4',
    };
    const finishCallbacks: Record<string, Function[]> = { finish: [] };
    const res: any = {
      setHeader: jest.fn(),
      on: (event: string, cb: Function) => {
        finishCallbacks[event].push(cb);
      },
      statusCode: 200,
    };
    const next = jest.fn();

    jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});

    requestLogger(req, res, next as any);

    expect(req.requestId).toBe(existingId);
  });

  it('propagates request ID into RequestContextService async context', () => {
    const req: any = {
      method: 'GET',
      originalUrl: '/test',
      headers: {},
      ip: '1.2.3.4',
    };
    const res: any = {
      setHeader: jest.fn(),
      on: jest.fn(),
      statusCode: 200,
    };

    let capturedRequestId: string | undefined;
    const next = jest.fn().mockImplementation(() => {
      const service = new RequestContextService();
      capturedRequestId = service.getRequestId();
    });

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    requestLogger(req, res, next as any);

    expect(next).toHaveBeenCalled();
    expect(capturedRequestId).toBeDefined();
    expect(capturedRequestId).toBe(req.requestId);
  });
});
