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

  it('propagates the request ID through RequestContextService so downstream code (e.g. auth/session services) can read it without the Express req object', () => {
    const existingId = 'propagation-test-id-456';
    const req: any = {
      method: 'GET',
      originalUrl: '/auth/authenticate',
      headers: { 'x-request-id': existingId },
      ip: '1.2.3.4',
    };
    const res: any = { setHeader: jest.fn(), on: jest.fn() };

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    let observedDuringNext: string | undefined;
    const next = jest.fn(() => {
      observedDuringNext = RequestContextService.getCurrentRequestId();
    });

    requestLogger(req, res, next as any);

    expect(next).toHaveBeenCalled();
    expect(observedDuringNext).toBe(existingId);
  });

  it('does not leak request context between two requests handled in sequence', () => {
    const res: any = { setHeader: jest.fn(), on: jest.fn() };
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    let firstObserved: string | undefined;
    requestLogger(
      {
        method: 'GET',
        originalUrl: '/a',
        headers: { 'x-request-id': 'request-a' },
        ip: '1.2.3.4',
      } as any,
      res,
      (() => {
        firstObserved = RequestContextService.getCurrentRequestId();
      }) as any,
    );

    let secondObserved: string | undefined;
    requestLogger(
      {
        method: 'GET',
        originalUrl: '/b',
        headers: { 'x-request-id': 'request-b' },
        ip: '1.2.3.4',
      } as any,
      res,
      (() => {
        secondObserved = RequestContextService.getCurrentRequestId();
      }) as any,
    );

    expect(firstObserved).toBe('request-a');
    expect(secondObserved).toBe('request-b');
  });
});
