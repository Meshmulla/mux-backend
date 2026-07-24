import { RequestContextService } from './request-context.service';

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  it('should store and retrieve request ID', async () => {
    const requestId = '12345-67890';

    await new Promise<void>((resolve) => {
      RequestContextService.run({ requestId }, () => {
        service.setRequestId(requestId);
        expect(service.getRequestId()).toBe(requestId);
        resolve();
      });
    });
  });

  it('should return undefined when no request ID is set', () => {
    expect(service.getRequestId()).toBeUndefined();
  });

  it('should isolate context between async operations', async () => {
    const requestId1 = 'request-1';
    const requestId2 = 'request-2';

    await Promise.all([
      new Promise<void>((resolve) => {
        RequestContextService.run({ requestId: requestId1 }, () => {
          service.setRequestId(requestId1);
          setTimeout(() => {
            expect(service.getRequestId()).toBe(requestId1);
            resolve();
          }, 10);
        });
      }),
      new Promise<void>((resolve) => {
        RequestContextService.run({ requestId: requestId2 }, () => {
          service.setRequestId(requestId2);
          setTimeout(() => {
            expect(service.getRequestId()).toBe(requestId2);
            resolve();
          }, 10);
        });
      }),
    ]);
  });
});
