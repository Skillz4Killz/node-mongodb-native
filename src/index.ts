import { Instrumentation } from './apm.ts';
import { MongoClient } from './mongo_client.ts';
import type { Callback } from './utils.ts';

// Set up the instrumentation method
/** @public */
export function instrument(callback: Callback): Instrumentation;
export function instrument(options?: unknown, callback?: Callback): Instrumentation {
  if (typeof options === 'function') {
    callback = options as Callback;
    options = {};
  }

  const instrumentation = new Instrumentation();
  instrumentation.instrument(MongoClient, callback);
  return instrumentation;
}
