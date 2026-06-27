import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface RequestContextData {
  requestId: string;
}

@Injectable()
export class RequestContextService {
  private static readonly asyncLocalStorage = new AsyncLocalStorage<RequestContextData>();

  setRequestId(requestId: string): void {
    const current = RequestContextService.asyncLocalStorage.getStore() || {};
    RequestContextService.asyncLocalStorage.enterWith({
      ...current,
      requestId,
    });
  }

  getRequestId(): string | undefined {
    return RequestContextService.asyncLocalStorage.getStore()?.requestId;
  }

  static bootstrapRequestId(requestId: string): void {
    const current = RequestContextService.asyncLocalStorage.getStore() || {};
    RequestContextService.asyncLocalStorage.enterWith({
      ...current,
      requestId,
    });
  }

  static run<R>(
    data: RequestContextData,
    callback: () => R,
  ): R {
    return RequestContextService.asyncLocalStorage.run(data, callback);
  }

  /**
   * Static convenience accessor for callers that don't have (or don't want)
   * a DI-injected instance — e.g. services constructed directly in unit
   * tests without a full Nest testing module. Reads the same store as
   * `getRequestId()`.
   */
  static getCurrentRequestId(): string | undefined {
    return RequestContextService.asyncLocalStorage.getStore()?.requestId;
  }
}
