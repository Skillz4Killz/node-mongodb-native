import { require } from "./utils.ts";
import type { Admin } from './admin.ts';
import type { Collection } from './collection.ts';
import type { Db } from './db.ts';
import type { MongoClient } from './mongo_client.ts';

let collection: typeof Collection;
let db: typeof Db;
let client: typeof MongoClient;
let admin: typeof Admin;

export function loadCollection(): typeof Collection {
  if (!collection) {
    collection = require('./collection').Collection;
  }
  return collection;
}

export function loadDb(): typeof Db {
  if (!db) {
    db = require('./db').Db;
  }
  return db;
}

export function loadMongoClient(): typeof MongoClient {
  if (!client) {
    client = require('./mongo_client').MongoClient;
  }
  return client;
}

export function loadAdmin(): typeof Admin {
  if (!admin) {
    admin = require('./admin').Admin;
  }
  return admin;
}
