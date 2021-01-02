import type { Callback } from '../utils.ts';
import type { Document } from '../bson.ts';
import type { Collection } from '../collection.ts';
import type { FindOptions } from './find.ts';
import { MongoError } from '../error.ts';
import type { Server } from '../sdam/server.ts';
import { CommandOperation } from './command.ts';
import { Aspect, defineAspects } from './operation.ts';
import type { ClientSession } from '../sessions.ts';

/** @internal */
export class FindOneOperation extends CommandOperation<Document> {
  options: FindOptions;
  collection: Collection;
  query: Document;

  constructor(collection: Collection, query: Document, options: FindOptions) {
    super(collection, options);

    this.options = options;
    this.collection = collection;
    this.query = query;
  }

  execute(server: Server, session: ClientSession, callback: Callback<Document>): void {
    const coll = this.collection;
    const query = this.query;
    const options = { ...this.options, ...this.bsonOptions, session };

    try {
      const cursor = coll.find(query, options).limit(-1).batchSize(1);

      // Return the item
      cursor.next((err, item) => {
        if (err != null) return callback(new MongoError(err));
        callback(undefined, item || undefined);
      });
    } catch (e) {
      callback(e);
    }
  }
}

defineAspects(FindOneOperation, [Aspect.EXPLAINABLE]);
