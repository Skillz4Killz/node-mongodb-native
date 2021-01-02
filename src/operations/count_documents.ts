import { AggregateOperation, AggregateOptions } from './aggregate.ts';
import type { Callback } from '../utils.ts';
import type { Document } from '../bson.ts';
import type { Server } from '../sdam/server.ts';
import type { Collection } from '../collection.ts';
import type { ClientSession } from '../sessions.ts';

/** @public */
export interface CountDocumentsOptions extends AggregateOptions {
  /** The number of documents to skip. */
  skip?: number;
  /** The maximum amounts to count before aborting. */
  limit?: number;
}

/** @internal */
export class CountDocumentsOperation extends AggregateOperation<number> {
  constructor(collection: Collection, query: Document, options: CountDocumentsOptions) {
    const pipeline = [];
    pipeline.push({ $match: query });

    if (typeof options.skip === 'number') {
      pipeline.push({ $skip: options.skip });
    }

    if (typeof options.limit === 'number') {
      pipeline.push({ $limit: options.limit });
    }

    pipeline.push({ $group: { _id: 1, n: { $sum: 1 } } });

    super(collection, pipeline, options);
  }

  execute(server: Server, session: ClientSession, callback: Callback<number>): void {
    super.execute(server, session, (err, result) => {
      if (err || !result) {
        callback(err);
        return;
      }

      // NOTE: We're avoiding creating a cursor here to reduce the callstack.
      const response = (result as unknown) as Document;
      if (response.cursor == null || response.cursor.firstBatch == null) {
        callback(undefined, 0);
        return;
      }

      const docs = response.cursor.firstBatch;
      callback(undefined, docs.length ? docs[0].n : 0);
    });
  }
}
