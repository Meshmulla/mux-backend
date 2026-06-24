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

  static run<R>(
    data: RequestContextData,
    callback: () => R,
  ): R {
    return RequestContextService.asyncLocalStorage.run(data, callback);
  }
}
