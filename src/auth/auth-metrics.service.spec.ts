import { AuthMetricsService, AuthOutcome } from './auth-metrics.service';

describe('AuthMetricsService', () => {
  let service: AuthMetricsService;

  beforeEach(() => {
    service = new AuthMetricsService();
  });

  describe('initial state', () => {
    it('returns zero counters on a fresh instance', () => {
      const snap = service.getSnapshot();
      expect(snap.totalAttempts).toBe(0);
      expect(snap.rateLimitHits).toBe(0);
      expect(snap.averageLatencyMs).toBe(0);
      expect(snap.p95LatencyMs).toBe(0);
    });

    it('all outcome buckets start at 0', () => {
      const { outcomes } = service.getSnapshot();
      for (const val of Object.values(outcomes)) {
        expect(val).toBe(0);
      }
    });

    it('lastResetAt is a recent Date', () => {
      const before = Date.now();
      const svc = new AuthMetricsService();
      const after = Date.now();
      const snap = svc.getSnapshot();
      expect(snap.lastResetAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(snap.lastResetAt.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('recordAttempt()', () => {
    it('increments totalAttempts', () => {
      service.recordAttempt('success_returning_user', 50);
      expect(service.getSnapshot().totalAttempts).toBe(1);
    });

    it('increments the correct outcome bucket', () => {
      service.recordAttempt('success_new_user', 100);
      service.recordAttempt('success_new_user', 120);
      service.recordAttempt('failure_unknown', 10);

      const { outcomes } = service.getSnapshot();
      expect(outcomes.success_new_user).toBe(2);
      expect(outcomes.failure_unknown).toBe(1);
      expect(outcomes.success_returning_user).toBe(0);
    });

    it('does not cross-contaminate outcome buckets', () => {
      const allOutcomes: AuthOutcome[] = [
        'success_new_user',
        'success_returning_user',
        'failure_invalid_payload',
        'failure_user_inactive',
        'failure_wallet_error',
        'failure_unknown',
      ];

      allOutcomes.forEach((o, i) => service.recordAttempt(o, i * 10));

      const { outcomes } = service.getSnapshot();
      allOutcomes.forEach((o) => expect(outcomes[o]).toBe(1));
    });

    it('computes correct average latency from a single sample', () => {
      service.recordAttempt('success_returning_user', 80);
      expect(service.getSnapshot().averageLatencyMs).toBe(80);
    });

    it('computes correct average latency from multiple samples', () => {
      service.recordAttempt('success_returning_user', 100);
      service.recordAttempt('success_returning_user', 200);
      service.recordAttempt('success_returning_user', 300);
      expect(service.getSnapshot().averageLatencyMs).toBe(200);
    });

    it('computes p95 latency correctly with enough samples', () => {
      // 20 samples: 1..20ms — p95 should be ~19ms
      for (let i = 1; i <= 20; i++) {
        service.recordAttempt('success_returning_user', i);
      }
      // sorted = [1..20], p95 index = ceil(0.95*20)-1 = 19-1 = 18 → value=19
      expect(service.getSnapshot().p95LatencyMs).toBe(19);
    });
  });

  describe('recordRateLimitHit()', () => {
    it('increments rateLimitHits', () => {
      service.recordRateLimitHit();
      service.recordRateLimitHit();
      expect(service.getSnapshot().rateLimitHits).toBe(2);
    });

    it('does not affect totalAttempts', () => {
      service.recordRateLimitHit();
      expect(service.getSnapshot().totalAttempts).toBe(0);
    });
  });

  describe('reset()', () => {
    it('zeros all counters', () => {
      service.recordAttempt('success_new_user', 100);
      service.recordAttempt('failure_unknown', 50);
      service.recordRateLimitHit();
      service.reset();

      const snap = service.getSnapshot();
      expect(snap.totalAttempts).toBe(0);
      expect(snap.rateLimitHits).toBe(0);
      expect(snap.averageLatencyMs).toBe(0);
      expect(snap.p95LatencyMs).toBe(0);
      for (const val of Object.values(snap.outcomes)) {
        expect(val).toBe(0);
      }
    });

    it('updates lastResetAt', async () => {
      const before = service.getSnapshot().lastResetAt;
      // Small delay to guarantee timestamp advances
      await new Promise((r) => setTimeout(r, 2));
      service.reset();
      const after = service.getSnapshot().lastResetAt;
      expect(after.getTime()).toBeGreaterThan(before.getTime());
    });

    it('allows new recordings after reset', () => {
      service.recordAttempt('success_new_user', 100);
      service.reset();
      service.recordAttempt('success_returning_user', 50);
      const snap = service.getSnapshot();
      expect(snap.totalAttempts).toBe(1);
      expect(snap.outcomes.success_returning_user).toBe(1);
      expect(snap.outcomes.success_new_user).toBe(0);
    });
  });

  describe('ring-buffer behaviour', () => {
    it('handles more samples than the ring-buffer capacity gracefully', () => {
      // Fill well beyond MAX_LATENCY_SAMPLES (1000) — just verify it doesn't
      // throw and produces a sensible average.
      const count = 1100;
      for (let i = 0; i < count; i++) {
        service.recordAttempt('success_returning_user', 100);
      }
      const snap = service.getSnapshot();
      expect(snap.totalAttempts).toBe(count);
      expect(snap.averageLatencyMs).toBe(100);
    });
  });

  describe('getSnapshot() immutability', () => {
    it('returns a copy of the outcomes object, not a live reference', () => {
      const snap1 = service.getSnapshot();
      service.recordAttempt('success_new_user', 10);
      const snap2 = service.getSnapshot();
      // snap1 should not reflect the new recording
      expect(snap1.outcomes.success_new_user).toBe(0);
      expect(snap2.outcomes.success_new_user).toBe(1);
    });
  });
});
