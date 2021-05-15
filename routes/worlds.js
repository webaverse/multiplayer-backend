const path = require('path');
const url = require('url');
const fs = require('fs');
// const https = require('https');
// const { putObject, uploadFromStream } = require('../aws.js');
// const crypto = require('crypto');
const child_process = require('child_process');
// const mime = require('mime');
const {_setCorsHeaders, getExt} = require('../utils.js');
const AWS = require('aws-sdk');
const ps = require('ps-node');
let config = require('../config.json');

const accessKeyId = process.env.accessKeyId || config.accessKeyId;
const secretAccessKey = process.env.secretAccessKey || config.secretAccessKey;
const privateIp = process.env.privateIp || config.privateIp;
const publicIp = process.env.publicIp || config.publicIp;

const awsConfig = new AWS.Config({
  credentials: new AWS.Credentials({
    accessKeyId,
    secretAccessKey,
  }),
  region: 'us-west-1',
});
// const ddb = new AWS.DynamoDB(awsConfig);
// const ddbd = new AWS.DynamoDB.DocumentClient(awsConfig);
const s3 = new AWS.S3(awsConfig);

const jsPath = '../dialog/index.js';
const bucketName = 'worlds.exokit.org';
const pidSymbol = Symbol('pid');

let startPort = 4000;
let endPort = 5000;

class WorldManager {
  constructor() {
    this.worlds = [];
    this.childProcesses = [];
    this.runnings = {};
    this.queues = {};

    this.loadPromise = this.loadWorlds();
  }
  waitForLoad() {
    return this.loadPromise;
  }
  findPort() {
    if (this.worlds.length > 0) {
      for (let port = startPort; port < endPort; port++) {
        if (!this.worlds.some(world => world.port === port)) {
          return port;
        }
      }
      return null;
    } else {
      return startPort;
    }
  }
  async loadWorlds() {
    this.worlds = await new Promise((accept, reject) => {
      ps.lookup({
        command: 'node',
        // psargs: 'ux',
      }, function(err, results) {
        if (!err) {
          results = results
            .filter(w => w.arguments[0] === jsPath)
            .map(w => {
              const {pid} = w;
              let [_, name, publicIp, privateIp, port] = w.arguments;
              port = parseInt(port, 10);
              return {
                name,
                publicIp,
                privateIp,
                port,
                [pidSymbol]: pid,
              };
            });
          console.log('got load world results', results);
          accept(results);
        } else {
          /* resultList.forEach(function( process ){
            if( process ){
              console.log( 'PID: %s, COMMAND: %s, ARGUMENTS: %s', process.pid, process.command, process.arguments );
            }
          }); */
          reject(err);
        }
      });
    });
  }
  async createWorld(name) {
    console.log('create world', name, new Error().stack);
    if (!this.runnings[name]) {
      this.runnings[name] = true;

      try {
        console.log('check 1');
        if (!this.worlds.some(w => w.name === name)) {
          console.log('check 2');
          let b;
          try {
            console.log('check 3');
            const o = await s3.getObject({
              Bucket: bucketName,
              Key: name,
            }).promise();
            console.log('got object', o);
            b = o.Body;
            console.log('check 4');
          } catch(err) {
            if (err.code === 'NoSuchKey') {
              // nothing
            } else {
              console.warn(err.stack);
            }
            b = null;
          }
          console.log('check 5');
          const dataFilePath = path.join(path.dirname(jsPath), 'data', name + '.bin');
          // console.log('placing data', b && b.byteLength);
          if (b) {
            await 
            fs.promises.writeFile(dataFilePath, b); 
          }
          
          console.log('check 6');

          const fullchain = path.join('..', 'exokit-backend', 'certs', 'fullchain.pem');
          let fullChainExists = fs.existsSync(fullchain);       
          const privkey = path.join('..', 'exokit-backend', 'certs', 'privkey.pem');
          let privkeyExists = fs.existsSync(privkey);     
          if(!fullChainExists || !privkeyExists){
            console.warn("WARNING: Couldn't retrieve SSL certs locally");
          }
          
          console.log('check 7');
          
          const port = this.findPort();
          const cp = child_process.spawn(process.argv[0], [
            jsPath,
            name,
            publicIp,
            privateIp,
            port,
          ], {
            cwd: path.dirname(jsPath),
            env: {
              PROTOO_LISTEN_PORT: port,
              MEDIASOUP_LISTEN_IP: privateIp,
              MEDIASOUP_ANNOUNCED_IP: publicIp,
              // NOTE: These certs will not be available in CI-produced builds
              HTTPS_CERT_FULLCHAIN: fullChainExists ? fullchain : null,
              HTTPS_CERT_PRIVKEY: privkeyExists ? privkey : null,
              AUTH_KEY: privkeyExists ? privkey : null,
              DATA_FILE: dataFilePath,
              // NUM_WORKERS: 2,
            },
          });
          
          console.log('check 8');
          
          cp.name = name;
          cp.dataFilePath = dataFilePath;
          cp.stdin.end();
          cp.stdout.pipe(process.stdout);
          cp.stderr.pipe(process.stderr);
          cp.on('error', err => {
            console.log('cp error', err.stack);
          });
          cp.on('exit', code => {
            console.log('cp exit', code);
            this.loadWorlds();
            this.childProcesses.splice(this.childProcesses.indexOf(cp), 1);
          });
          this.childProcesses.push(cp);

          console.log('check 9');

          await new Promise((accept, reject) => {
            cp.stdout.setEncoding('utf8');
            const _data = s => {
              if (/ready\n/.test(s)) {
                console.log('got dialog ready');

                accept();
                cp.stdout.removeListener('data', _end);
                cp.stdout.removeListener('end', _end);
              }
            };
            cp.stdout.on('data', _data);
            const _end = () => {
              reject(new Error('dialog did not output ready'));
            };
            cp.stdout.on('end', _end);
          });
          
          console.log('check 10');

          await this.loadWorlds();

          console.log('check 11');

          return {
            name,
            publicIp,
            privateIp,
            port,
          };
        } else {
          return null;
        }
      } finally {
        this.runnings[name] = false;

        const queue = this.queues[name] || [];
        if (queue.length > 0) {
          queue.splice(0, 1)();
        }
      }
    } else {
      return await new Promise((accept, reject) => {
        this.queues.push(async () => {
          const world = await this.createWorld(name);
          accept(world);
        });
      });
    }
  }
  async deleteWorld(name) {
    if (!this.runnings[name]) {
      this.runnings[name] = true;

      try {
        const world = this.worlds.find(w => w.name === name);

        if (world) {
          const cp = this.childProcesses.find(cp => cp.name === name);
          if (cp) {
            cp.kill();

            await new Promise((accept, reject) => {
              cp.on('exit', async () => {
                const b = await fs.promises.readFile(cp.dataFilePath);
                await s3.putObject({
                  Bucket: bucketName,
                  Key: name,
                  ContentType: 'application/octet-stream',
                  ContentLength: b.length,
                  Body: b,
                }).promise();

                await fs.promises.unlink(cp.dataFilePath);

                accept();
              });
            });
            return true;
          } else {
            return false;
          }
        } else {
          return false;
        }
      } finally {
        this.runnings[name] = false;

        const queue = this.queues[name] || [];
        if (queue.length > 0) {
          queue.splice(0, 1)();
        }
      }
    } else {
      return await new Promise((accept, reject) => {
        this.queues.push(async () => {
          const result = await this.deleteWorld(name);
          accept(result);
        });
      });
    }
  }
}
const worldManager = new WorldManager();

const _handleWorldsRequest = async (req, res) => {
  try {
    const {method, headers, url: u} = req;
    const o = url.parse(u);
    const match = decodeURIComponent(o.path).match(/^\/([a-z0-9\-\ \.]+)$/i);
    const p = match && match[1];

    res = _setCorsHeaders(res);
    
    console.log('get worlds request', {method, headers, o, p});
    
    if (method === 'OPTIONS') {
      res.end();
    } else if (method === 'GET' && o.path == '/') {
      res.end(JSON.stringify(worldManager.worlds));
    } else if (method === 'GET' && p) {
      const name = p;
      const world = worldManager.worlds.find(world => world.name === name);
      if (world) {
        res.end(JSON.stringify({
          result: world,
        }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({error: 'world not found'}));
      }
    } else if (method === 'POST' && p) {
      const name = p;
      const world = await worldManager.createWorld(name);

      if (world) {
        res.end(JSON.stringify({
          result: world,
        }));
      } else {
        res.statusCode = 400;
        res.end(JSON.stringify({error: 'name already taken'}));
      }
    } else if (method === 'DELETE' && p) {
      const name = p;
      const ok = await worldManager.deleteWorld(name);
      if (ok) {
        res.statusCode = 200;
        res.end();
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({error: 'world not found'}));
      }
    } else {
      res.statusCode = 404;
      res.end();
    }
  } catch (e) {
    console.log(e);
  }
}

module.exports = {
  worldManager,
  _handleWorldsRequest,
}