import { Aspect, defineAspects } from './operation.ts';
import { CommandOperation, CommandOperationOptions } from './command.ts';
import type { Callback } from '../utils.ts';
import type { Server } from '../sdam/server.ts';
import type { Db } from '../db.ts';
import type { ClientSession } from '../sessions.ts';

/** @public */
export type RemoveUserOptions = CommandOperationOptions;

/** @internal */
export class RemoveUserOperation extends CommandOperation<boolean> {
  options: RemoveUserOptions;
  username: string;

  constructor(db: Db, username: string, options: RemoveUserOptions) {
    super(db, options);
    this.options = options;
    this.username = username;
  }

  execute(server: Server, session: ClientSession, callback: Callback<boolean>): void {
    super.executeCommand(server, session, { dropUser: this.username }, err => {
      callback(err, err ? false : true);
    });
  }
}

defineAspects(RemoveUserOperation, [Aspect.WRITE_OPERATION]);
