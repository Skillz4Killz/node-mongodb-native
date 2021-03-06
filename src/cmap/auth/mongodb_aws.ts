import { AuthProvider, AuthContext } from './auth_provider.ts';
import { MongoCredentials } from './mongo_credentials.ts';
import { MongoError } from '../../error.ts';
import { maxWireVersion, Callback, ns } from '../../utils.ts';

import { AuthMechanism } from './defaultAuthProviders.ts';
import { deserialize, randomBytes, serialize, AWSSignerV4 } from "../../../deps.ts";
import { BSONSerializeOptions } from "../../../mod.ts";

const ASCII_N = 110;
const AWS_RELATIVE_URI = 'http://169.254.170.2';
const AWS_EC2_URI = 'http://169.254.169.254';
const AWS_EC2_PATH = '/latest/meta-data/iam/security-credentials';
const bsonOptions: BSONSerializeOptions = {
  promoteLongs: true,
  promoteValues: true,
  promoteBuffers: false
};

interface AWSSaslContinuePayload {
  a: string;
  d: string;
  t?: string;
}

export class MongoDBAWS extends AuthProvider {
  auth(authContext: AuthContext, callback: Callback): void {
    const { connection, credentials } = authContext;
    if (!credentials) {
      return callback(new MongoError('AuthContext must provide credentials.'));
    }

    // if ('kModuleError' in aws4) {
    //   return callback(aws4['kModuleError']);
    // }

    if (maxWireVersion(connection) < 9) {
      callback(new MongoError('MONGODB-AWS authentication requires MongoDB version 4.4 or later'));
      return;
    }

    if (credentials.username == null) {
      makeTempCredentials(credentials, (err, tempCredentials) => {
        if (err || !tempCredentials) return callback(err);

        authContext.credentials = tempCredentials;
        this.auth(authContext, callback);
      });

      return;
    }

    const username = credentials.username;
    const password = credentials.password;
    const db = credentials.source;
    const token = credentials.mechanismProperties.AWS_SESSION_TOKEN;
    randomBytes(32, (err, nonce) => {
      if (err) {
        callback(err);
        return;
      }

      const saslStart = {
        saslStart: 1,
        mechanism: 'MONGODB-AWS',
        payload: serialize({ r: nonce, p: ASCII_N }, bsonOptions)
      };

      connection.command(ns(`${db}.$cmd`), saslStart, undefined, async (err, res) => {
        if (err) return callback(err);

        const serverResponse = deserialize(res.payload.buffer, bsonOptions);
        const host = serverResponse.h;
        const serverNonce = serverResponse.s.buffer;
        if (serverNonce.length !== 64) {
          callback(
            new MongoError(`Invalid server nonce length ${serverNonce.length}, expected 64`)
          );

          return;
        }

        if (serverNonce.compare(nonce, 0, nonce?.length || 0, 0, nonce?.length || 0) !== 0) {
          callback(new MongoError('Server nonce does not begin with client nonce'));
          return;
        }

        if (host.length < 1 || host.length > 255 || host.indexOf('..') !== -1) {
          callback(new MongoError(`Server returned an invalid host: "${host}"`));
          return;
        }

        const signer = new AWSSignerV4(deriveRegion(serverResponse.h), {
          awsAccessKeyId: username,
          awsSecretKey: password,
          sessionToken: token,
        });
        const body = new TextEncoder().encode('Action=GetCallerIdentity&Version=2011-06-15');
        const request = new Request(host, {
          method: "POST",
          headers: {
            "Content-Length": body.length.toString(),
            "Content-Type": "application/x-www-form-urlencoded",
            "X-MongoDB-Server-Nonce": serverNonce.toString("base64"),
            "X-MongoDB-GS2-CB-Flag": "n",
          },
          body,
        });
        const req = await signer.sign("sts", request);
        const options = await fetch(req);

        const authorization = options.headers.get('Authorization');
        const date = options.headers.get('X-Amz-Date');
        const payload: AWSSaslContinuePayload = { a: authorization!, d: date! };
        if (token) {
          payload.t = token;
        }

        const saslContinue = {
          saslContinue: 1,
          conversationId: 1,
          payload: serialize(payload, bsonOptions)
        };

        connection.command(ns(`${db}.$cmd`), saslContinue, undefined, callback);
      });
    });
  }
}

interface AWSCredentials {
  AccessKeyId?: string;
  SecretAccessKey?: string;
  Token?: string;
}

function makeTempCredentials(credentials: MongoCredentials, callback: Callback<MongoCredentials>) {
  function done(creds: AWSCredentials) {
    if (creds.AccessKeyId == null || creds.SecretAccessKey == null || creds.Token == null) {
      callback(new MongoError('Could not obtain temporary MONGODB-AWS credentials'));
      return;
    }

    callback(
      undefined,
      new MongoCredentials({
        username: creds.AccessKeyId,
        password: creds.SecretAccessKey,
        source: credentials.source,
        mechanism: AuthMechanism.MONGODB_AWS,
        mechanismProperties: {
          AWS_SESSION_TOKEN: creds.Token
        }
      })
    );
  }

  // If the environment variable AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
  // is set then drivers MUST assume that it was set by an AWS ECS agent
  if (Deno.env.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")) {
    request(
      `${AWS_RELATIVE_URI}${Deno.env.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")}`,
      (err, res) => {
        if (err) return callback(err);
        done(res);
      }
    );

    return;
  }

  // Otherwise assume we are on an EC2 instance

  // get a token
  request(
    `${AWS_EC2_URI}/latest/api/token`,
    { method: 'PUT', json: false, headers: { 'X-aws-ec2-metadata-token-ttl-seconds': 30 } },
    (err, token) => {
      if (err) return callback(err);

      // get role name
      request(
        `${AWS_EC2_URI}/${AWS_EC2_PATH}`,
        { json: false, headers: { 'X-aws-ec2-metadata-token': token } },
        (err, roleName) => {
          if (err) return callback(err);

          // get temp credentials
          request(
            `${AWS_EC2_URI}/${AWS_EC2_PATH}/${roleName}`,
            { headers: { 'X-aws-ec2-metadata-token': token } },
            (err, creds) => {
              if (err) return callback(err);
              done(creds);
            }
          );
        }
      );
    }
  );
}

function deriveRegion(host: string) {
  const parts = host.split('.');
  if (parts.length === 1 || parts[1] === 'amazonaws') {
    return 'us-east-1';
  }

  return parts[1];
}

interface RequestOptions {
  json?: boolean;
  method?: string;
  timeout?: number;
  headers?: http.OutgoingHttpHeaders;
}

function request(uri: string, callback: Callback): void;
function request(uri: string, options: RequestOptions, callback: Callback): void;
function request(uri: string, _options: RequestOptions | Callback, _callback?: Callback) {
  let options = _options as RequestOptions;
  if ('function' === typeof _options) {
    options = {};
  }

  let callback: Callback = _options as Callback;
  if (_callback) {
    callback = _callback;
  }

  options = Object.assign(
    {
      method: 'GET',
      timeout: 10000,
      json: true
    },
    new URL(uri),
    options
  );

  const req = http.request(options, res => {
    res.setEncoding('utf8');

    let data = '';
    res.on('data', d => (data += d));
    res.on('end', () => {
      if (options.json === false) {
        callback(undefined, data);
        return;
      }

      try {
        const parsed = JSON.parse(data);
        callback(undefined, parsed);
      } catch (err) {
        callback(new MongoError(`Invalid JSON response: "${data}"`));
      }
    });
  });

  req.on('error', err => callback(err));
  req.end();
}
