import { PaymentMetricsService } from './payment-metrics.service';

describe('PaymentMetricsService', () => {
  let service: PaymentMetricsService;

  beforeEach(() => {
    service = new PaymentMetricsService();
  });

  afterEach(() => {
    service.reset();
  });

  describe('record — success path', () => {
    it('increments totalOperations and success outcome', () => {
      service.record({ operation: 'create', outcome: 'success', durationMs: 120, currency: 'USD' });
      const snap = service.getSnapshot();
      expect(snap.totalOperations).toBe(1);
      expect(snap.outcomeBreakdown.success).toBe(1);
      expect(snap.outcomeBreakdown.failure).toBe(0);
      expect(snap.operationBreakdown.create).toBe(1);
    });

    it('accumulates multiple operations correctly', () => {
      service.record({ operation: 'create', outcome: 'success', durationMs: 100 });
      service.record({ operation: 'create', outcome: 'success', durationMs: 200 });
      service.record({ operation: 'update', outcome: 'success', durationMs: 50 });
      const snap = service.getSnapshot();
      expect(snap.totalOperations).toBe(3);
      expect(snap.operationBreakdown.create).toBe(2);
      expect(snap.operationBreakdown.update).toBe(1);
    });

    it('computes averageDurationMs correctly', () => {
      service.record({ operation: 'create', outcome: 'success', durationMs: 100 });
      service.record({ operation: 'create', outcome: 'success', durationMs: 300 });
      expect(service.getSnapshot().averageDurationMs).toBe(200);
    });

    it('computes p95DurationMs over a set of samples', () => {
      for (let i = 1; i <= 20; i++) {
        service.record({ operation: 'findOne', outcome: 'success', durationMs: i * 10 });
      }
      const snap = service.getSnapshot();
      // 19th of 20 sorted values = 190ms at p95
      expect(snap.p95DurationMs).toBe(190);
    });

    it('records idempotent outcome separately from success', () => {
      service.record({ operation: 'create', outcome: 'idempotent', durationMs: 10 });
      const snap = service.getSnapshot();
      expect(snap.outcomeBreakdown.idempotent).toBe(1);
      expect(snap.outcomeBreakdown.success).toBe(0);
    });
  });

  describe('record — failure path', () => {
    it('increments failure outcome with failureReason', () => {
      service.record({
        operation: 'create',
        outcome: 'failure',
        durationMs: 80,
        failureReason: 'BadRequestException',
        currency: 'USD',
      });
      const snap = service.getSnapshot();
      expect(snap.outcomeBreakdown.failure).toBe(1);
      expect(snap.outcomeBreakdown.success).toBe(0);
      expect(snap.totalOperations).toBe(1);
    });

    it('does not expose failureReason in snapshot (label stays in log, not metrics)', () => {
      service.record({ operation: 'create', outcome: 'failure', durationMs: 50, failureReason: 'SomeInternalError' });
      const snap = service.getSnapshot();
      // Snapshot should not carry raw reason strings — no PII risk
      expect(snap).not.toHaveProperty('failureReason');
    });
  });

  describe('reset', () => {
    it('clears all counters and samples', () => {
      service.record({ operation: 'create', outcome: 'success', durationMs: 100 });
      service.reset();
      const snap = service.getSnapshot();
      expect(snap.totalOperations).toBe(0);
      expect(snap.averageDurationMs).toBe(0);
      expect(snap.p95DurationMs).toBe(0);
    });
  });
});
