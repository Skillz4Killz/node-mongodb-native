import { CommandOperation, CommandOperationOptions } from './command.ts';
import { Document } from '../bson.ts';
import { ReadPreference } from '../read_preference.ts';
import { MongoError } from '../error.ts';
import type { Callback } from '../utils.ts';
import type { Server } from '../sdam/server.ts';
import type { Db } from '../db.ts';
import type { Collection } from '../collection.ts';
import type { ClientSession } from '../sessions.ts';
import { Code } from "../../deps.ts";

/** @public */
export interface EvalOptions extends CommandOperationOptions {
  nolock?: boolean;
}

/** @internal */
export class EvalOperation extends CommandOperation<Document> {
  options: EvalOptions;
  code: Code;
  parameters?: Document | Document[];

  constructor(
    db: Db | Collection,
    code: Code,
    parameters?: Document | Document[],
    options?: EvalOptions
  ) {
    super(db, options);

    this.options = options ?? {};
    this.code = code;
    this.parameters = parameters;
    // force primary read preference
    Object.defineProperty(this, 'readPreference', {
      value: ReadPreference.primary,
      configurable: false,
      writable: false
    });
  }

  execute(server: Server, session: ClientSession, callback: Callback<Document>): void {
    let finalCode = this.code;
    let finalParameters: Document[] = [];

    // If not a code object translate to one
    if (!(finalCode && ((finalCode as unknown) as { _bsontype: string })._bsontype === 'Code')) {
      finalCode = new Code(finalCode as never);
    }

    // Ensure the parameters are correct
    if (this.parameters != null && typeof this.parameters !== 'function') {
      finalParameters = Array.isArray(this.parameters) ? this.parameters : [this.parameters];
    }

    // Create execution selector
    const cmd: Document = { $eval: finalCode, args: finalParameters };

    // Check if the nolock parameter is passed in
    if (this.options.nolock) {
      cmd.nolock = this.options.nolock;
    }

    // Execute the command
    super.executeCommand(server, session, cmd, (err, result) => {
      if (err) return callback(err);
      if (result && result.ok === 1) {
        return callback(undefined, result.retval);
      }

      if (result) {
        callback(MongoError.create({ message: `eval failed: ${result.errmsg}`, driver: true }));
        return;
      }

      callback(err, result);
    });
  }
}
