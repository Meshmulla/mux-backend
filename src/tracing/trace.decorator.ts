import { trace, SpanStatusCode, context, SpanKind } from '@opentelemetry/api';

/**
 * Method decorator that wraps the decorated method in an OpenTelemetry span.
 *
 * Usage:
 *   @Trace()                          // span name defaults to ClassName.methodName
 *   @Trace('custom.span.name')        // explicit span name
 *   @Trace('custom.span.name', { kind: SpanKind.CLIENT })
 *
 * When OpenTelemetry is disabled (OTEL_ENABLED !== "true") the SDK returns a
 * no-op tracer, so this decorator is transparent with zero overhead.
 */
export function Trace(
  spanName?: string,
  options: { kind?: SpanKind } = {},
): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original = descriptor.value as (...args: unknown[]) => unknown;

    if (typeof original !== 'function') {
      return descriptor;
    }

    const className = target.constructor?.name ?? 'Unknown';
    const methodName = String(propertyKey);
    const resolvedSpanName = spanName ?? `${className}.${methodName}`;
    const spanKind = options.kind ?? SpanKind.INTERNAL;

    descriptor.value = function (this: unknown, ...args: unknown[]): unknown {
      const tracer = trace.getTracer('mux-backend');
      const span = tracer.startSpan(resolvedSpanName, { kind: spanKind });

      const ctx = trace.setSpan(context.active(), span);

      const executeInContext = (): unknown => {
        try {
          const result = original.apply(this, args);

          // Handle async methods
          if (result instanceof Promise) {
            return result
              .then((value: unknown) => {
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
                return value;
              })
              .catch((err: unknown) => {
                const message =
                  err instanceof Error ? err.message : String(err);
                span.setStatus({ code: SpanStatusCode.ERROR, message });
                if (err instanceof Error) {
                  span.recordException(err);
                }
                span.end();
                throw err;
              });
          }

          // Synchronous methods
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          if (err instanceof Error) {
            span.recordException(err);
          }
          span.end();
          throw err;
        }
      };

      return context.with(ctx, executeInContext);
    };

    return descriptor;
  };
}
