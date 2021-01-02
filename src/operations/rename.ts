import { checkCollectionName, Callback } from '../utils.ts';
import { loadCollection } from '../dynamic_loaders.ts';
import { RunAdminCommandOperation } from './run_command.ts';
import { defineAspects, Aspect } from './operation.ts';
import type { Server } from '../sdam/server.ts';
import type { Collection } from '../collection.ts';
import type { CommandOperationOptions } from './command.ts';
import { MongoError } from '../error.ts';
import type { ClientSession } from '../sessions.ts';

/** @public */
export interface RenameOptions extends CommandOperationOptions {
  /** Drop the target name collection if it previously exists. */
  dropTarget?: boolean;
  /** Unclear */
  new_collection?: boolean;
}

/** @internal */
export class RenameOperation extends RunAdminCommandOperation {
  options: RenameOptions;
  collection: Collection;
  newName: string;

  constructor(collection: Collection, newName: string, options: RenameOptions) {
    // Check the collection name
    checkCollectionName(newName);

    // Build the command
    const renameCollection = collection.namespace;
    const toCollection = collection.s.namespace.withCollection(newName).toString();
    const dropTarget = typeof options.dropTarget === 'boolean' ? options.dropTarget : false;
    const cmd = { renameCollection: renameCollection, to: toCollection, dropTarget: dropTarget };

    super(collection, cmd, options);
    this.options = options;
    this.collection = collection;
    this.newName = newName;
  }

  execute(server: Server, session: ClientSession, callback: Callback<Collection>): void {
    const Collection = loadCollection();
    const coll = this.collection;

    super.execute(server, session, (err, doc) => {
      if (err) return callback(err);
      // We have an error
      if (doc.errmsg) {
        return callback(new MongoError(doc));
      }

      try {
        return callback(undefined, new Collection(coll.s.db, this.newName, coll.s.options));
      } catch (err) {
        return callback(new MongoError(err));
      }
    });
  }
}

defineAspects(RenameOperation, [Aspect.WRITE_OPERATION]);
