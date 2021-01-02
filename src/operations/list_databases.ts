import { CommandOperation, CommandOperationOptions } from './command.ts';
import { Aspect, defineAspects } from './operation.ts';
import { MongoDBNamespace, Callback } from '../utils.ts';
import type { Document } from '../bson.ts';
import type { Server } from '../sdam/server.ts';
import type { Db } from '../db.ts';
import type { ClientSession } from '../sessions.ts';

/** @public */
export type ListDatabasesResult = string[] | Document[];

/** @public */
export interface ListDatabasesOptions extends CommandOperationOptions {
  /** A query predicate that determines which databases are listed */
  filter?: Document;
  /** A flag to indicate whether the command should return just the database names, or return both database names and size information */
  nameOnly?: boolean;
  /** A flag that determines which databases are returned based on the user privileges when access control is enabled */
  authorizedDatabases?: boolean;
}

/** @internal */
export class ListDatabasesOperation extends CommandOperation<ListDatabasesResult> {
  options: ListDatabasesOptions;

  constructor(db: Db, options?: ListDatabasesOptions) {
    super(db, options);
    this.options = options ?? {};
    this.ns = new MongoDBNamespace('admin', '$cmd');
  }

  execute(server: Server, session: ClientSession, callback: Callback<ListDatabasesResult>): void {
    const cmd: Document = { listDatabases: 1 };
    if (this.options.nameOnly) {
      cmd.nameOnly = Number(cmd.nameOnly);
    }

    if (this.options.filter) {
      cmd.filter = this.options.filter;
    }

    if (typeof this.options.authorizedDatabases === 'boolean') {
      cmd.authorizedDatabases = this.options.authorizedDatabases;
    }

    super.executeCommand(server, session, cmd, callback);
  }
}

defineAspects(ListDatabasesOperation, [Aspect.READ_OPERATION, Aspect.RETRYABLE]);
