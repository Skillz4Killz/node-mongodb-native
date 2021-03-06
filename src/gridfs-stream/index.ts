import { EventEmitter } from "../../deps.ts";
import { MongoError } from "../error.ts";
import {
  GridFSBucketReadStream,
  GridFSBucketReadStreamOptions,
  GridFSBucketReadStreamOptionsWithRevision,
} from "./download.ts";
import { GridFSBucketWriteStream, GridFSBucketWriteStreamOptions, TFileId } from "./upload.ts";
import { executeLegacyOperation, Callback, getTopology } from "../utils.ts";
import { WriteConcernOptions, WriteConcern } from "../write_concern.ts";
import type { Document } from "../bson.ts";
import type { Db } from "../db.ts";
import type { ReadPreference } from "../read_preference.ts";
import type { Collection } from "../collection.ts";
import type { FindOptions } from "./../operations/find.ts";
import type { Sort } from "../sort.ts";
import type { Logger } from "../logger.ts";
import type { FindCursor } from "../cursor/find_cursor.ts";

const DEFAULT_GRIDFS_BUCKET_OPTIONS: {
  bucketName: string;
  chunkSizeBytes: number;
} = {
  bucketName: "fs",
  chunkSizeBytes: 255 * 1024,
};

/** @public */
export interface GridFSBucketOptions extends WriteConcernOptions {
  /** The 'files' and 'chunks' collections will be prefixed with the bucket name followed by a dot. */
  bucketName?: string;
  /** Number of bytes stored in each chunk. Defaults to 255KB */
  chunkSizeBytes?: number;
  /** Read preference to be passed to read operations */
  readPreference?: ReadPreference;
}

/** @internal */
export interface GridFSBucketPrivate {
  db: Db;
  options: {
    bucketName: string;
    chunkSizeBytes: number;
    readPreference?: ReadPreference;
    writeConcern: WriteConcern | undefined;
  };
  _chunksCollection: Collection;
  _filesCollection: Collection;
  checkedIndexes: boolean;
  calledOpenUploadStream: boolean;
}

/**
 * Constructor for a streaming GridFS interface
 * @public
 */
export class GridFSBucket extends EventEmitter {
  /** @internal */
  s: GridFSBucketPrivate;

  /**
   * When the first call to openUploadStream is made, the upload stream will
   * check to see if it needs to create the proper indexes on the chunks and
   * files collections. This event is fired either when 1) it determines that
   * no index creation is necessary, 2) when it successfully creates the
   * necessary indexes.
   * @event
   */
  static readonly INDEX = "index" as const;

  constructor(db: Db, options?: GridFSBucketOptions) {
    super();
    this.setMaxListeners(0);
    const privateOptions = {
      ...DEFAULT_GRIDFS_BUCKET_OPTIONS,
      ...options,
      writeConcern: WriteConcern.fromOptions(options),
    };
    this.s = {
      db,
      options: privateOptions,
      _chunksCollection: db.collection(privateOptions.bucketName + ".chunks"),
      _filesCollection: db.collection(privateOptions.bucketName + ".files"),
      checkedIndexes: false,
      calledOpenUploadStream: false,
    };
  }

  /**
   * Returns a writable stream (GridFSBucketWriteStream) for writing
   * buffers to GridFS. The stream's 'id' property contains the resulting
   * file's id.
   *
   * @param filename - The value of the 'filename' key in the files doc
   * @param options - Optional settings.
   */

  openUploadStream(filename: string, options?: GridFSBucketWriteStreamOptions): GridFSBucketWriteStream {
    return new GridFSBucketWriteStream(this, filename, options);
  }

  /**
   * Returns a writable stream (GridFSBucketWriteStream) for writing
   * buffers to GridFS for a custom file id. The stream's 'id' property contains the resulting
   * file's id.
   */
  openUploadStreamWithId(
    id: TFileId,
    filename: string,
    options?: GridFSBucketWriteStreamOptions
  ): GridFSBucketWriteStream {
    return new GridFSBucketWriteStream(this, filename, { ...options, id });
  }

  /** Returns a readable stream (GridFSBucketReadStream) for streaming file data from GridFS. */
  openDownloadStream(id: TFileId, options?: GridFSBucketReadStreamOptions): GridFSBucketReadStream {
    return new GridFSBucketReadStream(
      this.s._chunksCollection,
      this.s._filesCollection,
      this.s.options.readPreference,
      { _id: id },
      options
    );
  }

  /**
   * Deletes a file with the given id
   *
   * @param id - The id of the file doc
   */
  delete(id: TFileId): Promise<undefined>;
  delete(id: TFileId, callback: Callback<void>): void;
  delete(id: TFileId, callback?: Callback<void>): Promise<undefined> | void {
    return executeLegacyOperation(getTopology(this.s.db), _delete, [this, id, callback], {
      skipSessions: true,
    });
  }

  /** Convenience wrapper around find on the files collection */
  find(filter: Document, options?: FindOptions): FindCursor {
    filter = filter || {};
    options = options ?? {};
    return this.s._filesCollection.find(filter, options);
  }

  /**
   * Returns a readable stream (GridFSBucketReadStream) for streaming the
   * file with the given name from GridFS. If there are multiple files with
   * the same name, this will stream the most recent file with the given name
   * (as determined by the `uploadDate` field). You can set the `revision`
   * option to change this behavior.
   */
  openDownloadStreamByName(
    filename: string,
    options?: GridFSBucketReadStreamOptionsWithRevision
  ): GridFSBucketReadStream {
    let sort: Sort = { uploadDate: -1 };
    let skip = undefined;
    if (options && options.revision != null) {
      if (options.revision >= 0) {
        sort = { uploadDate: 1 };
        skip = options.revision;
      } else {
        skip = -options.revision - 1;
      }
    }
    return new GridFSBucketReadStream(
      this.s._chunksCollection,
      this.s._filesCollection,
      this.s.options.readPreference,
      { filename },
      { ...options, sort, skip }
    );
  }

  /**
   * Renames the file with the given _id to the given string
   *
   * @param id - the id of the file to rename
   * @param filename - new name for the file
   */
  rename(id: TFileId, filename: string): Promise<void>;
  rename(id: TFileId, filename: string, callback: Callback<void>): void;
  rename(id: TFileId, filename: string, callback?: Callback<void>): Promise<void> | void {
    return executeLegacyOperation(getTopology(this.s.db), _rename, [this, id, filename, callback], {
      skipSessions: true,
    });
  }

  /** Removes this bucket's files collection, followed by its chunks collection. */
  drop(): Promise<void>;
  drop(callback: Callback<void>): void;
  drop(callback?: Callback<void>): Promise<void> | void {
    return executeLegacyOperation(getTopology(this.s.db), _drop, [this, callback], {
      skipSessions: true,
    });
  }

  /** Get the Db scoped logger. */
  getLogger(): Logger {
    return this.s.db.s.logger;
  }
}

function _delete(bucket: GridFSBucket, id: TFileId, callback: Callback<void>): void {
  return bucket.s._filesCollection.deleteOne({ _id: id }, (error, res) => {
    if (error) {
      return callback(error);
    }

    return bucket.s._chunksCollection.deleteMany({ files_id: id }, (error) => {
      if (error) {
        return callback(error);
      }

      // Delete orphaned chunks before returning FileNotFound
      if (!res?.deletedCount) {
        const errmsg = "FileNotFound: no file with id " + id + " found";
        return callback(new Error(errmsg));
      }

      return callback();
    });
  });
}

function _rename(bucket: GridFSBucket, id: TFileId, filename: string, callback: Callback<void>): void {
  const filter = { _id: id };
  const update = { $set: { filename } };
  return bucket.s._filesCollection.updateOne(filter, update, (error?, res?) => {
    if (error) {
      return callback(error);
    }

    if (!res?.matchedCount) {
      return callback(new MongoError(`File with id ${id} not found`));
    }

    return callback();
  });
}

function _drop(bucket: GridFSBucket, callback: Callback<void>): void {
  return bucket.s._filesCollection.drop((error?: Error) => {
    if (error) {
      return callback(error);
    }
    return bucket.s._chunksCollection.drop((error?: Error) => {
      if (error) {
        return callback(error);
      }

      return callback();
    });
  });
}
