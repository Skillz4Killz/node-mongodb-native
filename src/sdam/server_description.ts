import { arrayStrictEqual, errorStrictEqual } from '../utils.ts';
import { ServerType } from './common.ts';
import { now } from '../utils.ts';
import type { ClusterTime } from './common.ts';
import { Document, Long, ObjectId } from "../../deps.ts";

const WRITABLE_SERVER_TYPES = new Set([
  ServerType.RSPrimary,
  ServerType.Standalone,
  ServerType.Mongos
]);

const DATA_BEARING_SERVER_TYPES = new Set([
  ServerType.RSPrimary,
  ServerType.RSSecondary,
  ServerType.Mongos,
  ServerType.Standalone
]);

/** @public */
export interface TopologyVersion {
  processId: ObjectId;
  counter: Long;
}

/** @public */
export type TagSet = { [key: string]: string };

/** @internal */
export interface ServerDescriptionOptions {
  /** An Error used for better reporting debugging */
  error?: Error;

  /** The round trip time to ping this server (in ms) */
  roundTripTime?: number;

  /** The topologyVersion */
  topologyVersion?: TopologyVersion;
}

/**
 * The client's view of a single server, based on the most recent ismaster outcome.
 *
 * Internal type, not meant to be directly instantiated
 * @public
 */
export class ServerDescription {
  address: string;
  type: ServerType;
  hosts: string[];
  passives: string[];
  arbiters: string[];
  tags: TagSet;

  error?: Error;
  topologyVersion?: TopologyVersion;
  minWireVersion: number;
  maxWireVersion: number;
  roundTripTime: number;
  lastUpdateTime: number;
  lastWriteDate: number;

  me?: string;
  primary?: string;
  setName?: string;
  setVersion?: number;
  electionId?: ObjectId;
  logicalSessionTimeoutMinutes?: number;

  // NOTE: does this belong here? It seems we should gossip the cluster time at the CMAP level
  $clusterTime?: ClusterTime;

  /**
   * Create a ServerDescription
   * @internal
   *
   * @param address - The address of the server
   * @param ismaster - An optional ismaster response for this server
   */
  constructor(address: string, ismaster?: Document, options?: ServerDescriptionOptions) {
    this.address = address;
    this.type = parseServerType(ismaster);
    this.hosts = ismaster?.hosts?.map((host: string) => host.toLowerCase()) ?? [];
    this.passives = ismaster?.passives?.map((host: string) => host.toLowerCase()) ?? [];
    this.arbiters = ismaster?.arbiters?.map((host: string) => host.toLowerCase()) ?? [];
    this.tags = ismaster?.tags ?? {};
    this.minWireVersion = ismaster?.minWireVersion ?? 0;
    this.maxWireVersion = ismaster?.maxWireVersion ?? 0;
    this.roundTripTime = options?.roundTripTime ?? -1;
    this.lastUpdateTime = now();
    this.lastWriteDate = ismaster?.lastWrite?.lastWriteDate ?? 0;

    if (options?.topologyVersion) {
      this.topologyVersion = options.topologyVersion;
    } else if (ismaster?.topologyVersion) {
      this.topologyVersion = ismaster.topologyVersion;
    }

    if (options?.error) {
      this.error = options.error;
    }

    if (ismaster?.primary) {
      this.primary = ismaster.primary;
    }

    if (ismaster?.me) {
      this.me = ismaster.me.toLowerCase();
    }

    if (ismaster?.setName) {
      this.setName = ismaster.setName;
    }

    if (ismaster?.setVersion) {
      this.setVersion = ismaster.setVersion;
    }

    if (ismaster?.electionId) {
      this.electionId = ismaster.electionId;
    }

    if (ismaster?.logicalSessionTimeoutMinutes) {
      this.logicalSessionTimeoutMinutes = ismaster.logicalSessionTimeoutMinutes;
    }

    if (ismaster?.$clusterTime) {
      this.$clusterTime = ismaster.$clusterTime;
    }
  }

  get allHosts(): string[] {
    return this.hosts.concat(this.arbiters).concat(this.passives);
  }

  /** Is this server available for reads*/
  get isReadable(): boolean {
    return this.type === ServerType.RSSecondary || this.isWritable;
  }

  /** Is this server data bearing */
  get isDataBearing(): boolean {
    return DATA_BEARING_SERVER_TYPES.has(this.type);
  }

  /** Is this server available for writes */
  get isWritable(): boolean {
    return WRITABLE_SERVER_TYPES.has(this.type);
  }

  get host(): string {
    const chopLength = `:${this.port}`.length;
    return this.address.slice(0, -chopLength);
  }

  get port(): number {
    const port = this.address.split(':').pop();
    return port ? Number.parseInt(port, 10) : 27017;
  }

  /**
   * Determines if another `ServerDescription` is equal to this one per the rules defined
   * in the {@link https://github.com/mongodb/specifications/blob/master/source/server-discovery-and-monitoring/server-discovery-and-monitoring.rst#serverdescription|SDAM spec}
   */
  equals(other: ServerDescription): boolean {
    const topologyVersionsEqual =
      this.topologyVersion === other.topologyVersion ||
      compareTopologyVersion(this.topologyVersion, other.topologyVersion) === 0;

    const electionIdsEqual: boolean =
      this.electionId && other.electionId
        ? other.electionId && this.electionId.equals(other.electionId)
        : this.electionId === other.electionId;

    return (
      other != null &&
      errorStrictEqual(this.error, other.error) &&
      this.type === other.type &&
      this.minWireVersion === other.minWireVersion &&
      arrayStrictEqual(this.hosts, other.hosts) &&
      tagsStrictEqual(this.tags, other.tags) &&
      this.setName === other.setName &&
      this.setVersion === other.setVersion &&
      electionIdsEqual &&
      this.primary === other.primary &&
      this.logicalSessionTimeoutMinutes === other.logicalSessionTimeoutMinutes &&
      topologyVersionsEqual
    );
  }
}

// Parses an `ismaster` message and determines the server type
export function parseServerType(ismaster?: Document): ServerType {
  if (!ismaster || !ismaster.ok) {
    return ServerType.Unknown;
  }

  if (ismaster.isreplicaset) {
    return ServerType.RSGhost;
  }

  if (ismaster.msg && ismaster.msg === 'isdbgrid') {
    return ServerType.Mongos;
  }

  if (ismaster.setName) {
    if (ismaster.hidden) {
      return ServerType.RSOther;
    } else if (ismaster.ismaster) {
      return ServerType.RSPrimary;
    } else if (ismaster.secondary) {
      return ServerType.RSSecondary;
    } else if (ismaster.arbiterOnly) {
      return ServerType.RSArbiter;
    } else {
      return ServerType.RSOther;
    }
  }

  return ServerType.Standalone;
}

function tagsStrictEqual(tags: TagSet, tags2: TagSet): boolean {
  const tagsKeys = Object.keys(tags);
  const tags2Keys = Object.keys(tags2);

  return (
    tagsKeys.length === tags2Keys.length &&
    tagsKeys.every((key: string) => tags2[key] === tags[key])
  );
}

/**
 * Compares two topology versions.
 *
 * @returns A negative number if `lhs` is older than `rhs`; positive if `lhs` is newer than `rhs`; 0 if they are equivalent.
 */
export function compareTopologyVersion(lhs?: TopologyVersion, rhs?: TopologyVersion): number {
  if (lhs == null || rhs == null) {
    return -1;
  }

  if (lhs.processId.equals(rhs.processId)) {
    // TODO: handle counters as Longs
    if (lhs.counter === rhs.counter) {
      return 0;
    } else if (lhs.counter < rhs.counter) {
      return -1;
    }

    return 1;
  }

  return -1;
}
