import { SerializeOptions } from "../deps.ts";
import type { OperationParent } from './operations/command.ts';
// import { SerializeOptions } from '../deps.ts';


/** @public */
export interface Document {
  [key: string]: any;
}


// TODO: Remove me when types from BSON are updated
/**
 * BSON Serialization options.
 * @public
 */
export interface BSONSerializeOptions extends Omit<SerializeOptions, "index"> {
  /** Return document results as raw BSON buffers */
  fieldsAsRaw?: { [key: string]: boolean };
  /** Promotes BSON values to native types where possible, set to false to only receive wrapper types */
  promoteValues?: boolean;
  /** Promotes Binary BSON values to native Node Buffers */
  promoteBuffers?: boolean;
  /** Promotes long values to number if they fit inside the 53 bits resolution */
  promoteLongs?: boolean;
  /** Serialize functions on any object */
  serializeFunctions?: boolean;
  /** Specify if the BSON serializer should ignore undefined fields */
  ignoreUndefined?: boolean;

  raw?: boolean;
}

export function pluckBSONSerializeOptions(options: BSONSerializeOptions): BSONSerializeOptions {
  const {
    fieldsAsRaw,
    promoteValues,
    promoteBuffers,
    promoteLongs,
    serializeFunctions,
    ignoreUndefined,
    raw
  } = options;
  return {
    fieldsAsRaw,
    promoteValues,
    promoteBuffers,
    promoteLongs,
    serializeFunctions,
    ignoreUndefined,
    raw
  };
}

/**
 * Merge the given BSONSerializeOptions, preferring options over the parent's options, and
 * substituting defaults for values not set.
 *
 * @internal
 */
export function resolveBSONOptions(
  options?: BSONSerializeOptions,
  parent?: OperationParent
): BSONSerializeOptions {
  const parentOptions = parent?.bsonOptions;
  return {
    raw: options?.raw ?? parentOptions?.raw ?? false,
    promoteLongs: options?.promoteLongs ?? parentOptions?.promoteLongs ?? true,
    promoteValues: options?.promoteValues ?? parentOptions?.promoteValues ?? true,
    promoteBuffers: options?.promoteBuffers ?? parentOptions?.promoteBuffers ?? false,
    ignoreUndefined: options?.ignoreUndefined ?? parentOptions?.ignoreUndefined ?? false,
    serializeFunctions: options?.serializeFunctions ?? parentOptions?.serializeFunctions ?? false,
    fieldsAsRaw: options?.fieldsAsRaw ?? parentOptions?.fieldsAsRaw ?? {}
  };
}
