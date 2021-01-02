import { MongoError } from '../error.ts';
import type { Connection } from './connection.ts';
import type { ConnectionPool } from './connection_pool.ts';

/**
 * An error indicating a connection pool is closed
 * @category Error
 */
export class PoolClosedError extends MongoError {
  /** The address of the connection pool */
  address: string;

  constructor(pool: ConnectionPool) {
    super('Attempted to check out a connection from closed connection pool');
    this.name = 'MongoPoolClosedError';
    this.address = pool.address;
  }
}

/**
 * An error thrown when a request to check out a connection times out
 * @category Error
 */
export class WaitQueueTimeoutError extends MongoError {
  /** The address of the connection pool */
  address: string;

  constructor(pool: Connection | ConnectionPool) {
    super('Timed out while checking out a connection from connection pool');
    this.name = 'MongoWaitQueueTimeoutError';
    this.address = pool.address;
  }
}
