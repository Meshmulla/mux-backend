import { Injectable } from '@nestjs/common';

export interface MetricsCollector {
  incrementCounter(name: string, labels?: Record<string, string>): void;
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void;
}

/**
 * Metrics service using prom-client for Prometheus instrumentation
 * Provides a simple interface for registering and recording metrics
 */
@Injectable()
export class MetricsService implements MetricsCollector {
  private counters: Map<string, any> = new Map();
  private histograms: Map<string, any> = new Map();

  constructor() {
    // Metrics will be initialized on demand
  }

  /**
   * Registers or retrieves a counter metric
   */
  private getOrCreateCounter(name: string, help: string, labels: string[] = []) {
    if (!this.counters.has(name)) {
      const Counter = require('prom-client').Counter;
      const counter = new Counter({
        name,
        help,
        labelNames: labels,
      });
      this.counters.set(name, counter);
    }
    return this.counters.get(name);
  }

  /**
   * Registers or retrieves a histogram metric
   */
  private getOrCreateHistogram(name: string, help: string, labels: string[] = []) {
    if (!this.histograms.has(name)) {
      const Histogram = require('prom-client').Histogram;
      const histogram = new Histogram({
        name,
        help,
        labelNames: labels,
        buckets: [0.1, 0.5, 1, 2, 5, 10], // seconds
      });
      this.histograms.set(name, histogram);
    }
    return this.histograms.get(name);
  }

  /**
   * Increments a counter with optional labels
   */
  incrementCounter(name: string, labels?: Record<string, string>): void {
    // Extract label names from the first call or use defaults
    const labelNames = Object.keys(labels || {});
    const counter = this.getOrCreateCounter(name, name, labelNames);

    if (labels && Object.keys(labels).length > 0) {
      counter.inc(labels);
    } else {
      counter.inc();
    }
  }

  /**
   * Records a histogram value with optional labels (in seconds)
   */
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const labelNames = Object.keys(labels || {});
    const histogram = this.getOrCreateHistogram(name, name, labelNames);

    if (labels && Object.keys(labels).length > 0) {
      histogram.observe(labels, value);
    } else {
      histogram.observe(value);
    }
  }

  /**
   * Gets all registered metrics for Prometheus scraping
   */
  getMetrics(): string {
    const register = require('prom-client').register;
    return register.metrics();
  }
}
