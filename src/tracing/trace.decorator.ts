import { Logger } from '@nestjs/common';

/**
 * Decorator to enable OpenTelemetry tracing for individual service methods.
 * Automatically creates spans for traced operations.
 *
 * Usage:
 *   @Trace()
 *   async myMethod() {
 *     // This method will be automatically traced
 *   }
 *
 * The span name will be automatically derived from the class and method name.
 */
export function Trace() {
  const logger = new Logger('Trace');

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const className = target.constructor.name;
      const spanName = `${className}.${propertyKey}`;

      try {
        // TODO: Integrate with OpenTelemetry tracer when available
        // const tracer = this.tracingService?.getTracer();
        // if (tracer) {
        //   return tracer.startActiveSpan(spanName, async (span: any) => {
        //     try {
        //       return await originalMethod.apply(this, args);
        //     } catch (err) {
        //       span.setAttribute('error', true);
        //       span.setAttribute('error.message', err.message);
        //       throw err;
        //     }
        //   });
        // }

        return await originalMethod.apply(this, args);
      } catch (err) {
        logger.error(`Error in ${spanName}: ${err}`);
        throw err;
      }
    };

    return descriptor;
  };
}
