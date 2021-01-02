import { Aspect, defineAspects, Hint } from './operation.ts';
import { CommandOperation, CommandOperationOptions } from './command.ts';
import type { Callback } from '../utils.ts';
import type { Document } from '../bson.ts';
import type { Server } from '../sdam/server.ts';
import type { Collection } from '../collection.ts';
import type { ClientSession } from '../sessions.ts';

/** @public */
export interface EstimatedDocumentCountOptions extends CommandOperationOptions {
  skip?: number;
  limit?: number;
  hint?: Hint;
}

/** @internal */
export class EstimatedDocumentCountOperation extends CommandOperation<number> {
  options: EstimatedDocumentCountOptions;
  collectionName: string;
  query?: Document;

  constructor(collection: Collection, options: EstimatedDocumentCountOptions);
  constructor(collection: Collection, query: Document, options: EstimatedDocumentCountOptions);
  constructor(
    collection: Collection,
    query?: Document | EstimatedDocumentCountOptions,
    options?: EstimatedDocumentCountOptions
  ) {
    if (typeof options === 'undefined') {
      options = query as EstimatedDocumentCountOptions;
      query = undefined;
    }

    super(collection, options);
    this.options = options;
    this.collectionName = collection.collectionName;
    if (query) {
      this.query = query;
    }
  }

  execute(server: Server, session: ClientSession, callback: Callback<number>): void {
    const options = this.options;
    const cmd: Document = { count: this.collectionName };

    if (this.query) {
      cmd.query = this.query;
    }

    if (typeof options.skip === 'number') {
      cmd.skip = options.skip;
    }

    if (typeof options.limit === 'number') {
      cmd.limit = options.limit;
    }

    if (options.hint) {
      cmd.hint = options.hint;
    }

    super.executeCommand(server, session, cmd, (err, response) => {
      if (err) {
        callback(err);
        return;
      }

      callback(undefined, response.n || 0);
    });
  }
}

defineAspects(EstimatedDocumentCountOperation, [Aspect.READ_OPERATION, Aspect.RETRYABLE]);
