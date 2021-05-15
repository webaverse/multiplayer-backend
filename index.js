const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
/* require('dotenv').config();
const path = require('path');
const stream = require('stream');
const fs = require('fs');
const url = require('url');
const querystring = require('querystring');
const http = require('http');
const https = require('https');
const dns = require('dns');
const crypto = require('crypto');
const zlib = require('zlib');
const os = require('os');
const child_process = require('child_process');
const mkdirp = require('mkdirp');
const FormData = require('form-data');
// const express = require('express');
const httpProxy = require('http-proxy');
const ws = require('ws');
// const LRU = require('lru');
const mime = require('mime');
const AWS = require('aws-sdk');
const Stripe = require('stripe');
// const puppeteer = require('puppeteer');
const namegen = require('./namegen.js');
const Base64Encoder = require('./encoder.js').Encoder;
// const {JSONServer, CustomEvent} = require('./dist/sync-server.js');
const fetch = require('node-fetch');
const {SHA3} = require('sha3');
const {default: formurlencoded} = require('form-urlencoded');
const bip39 = require('bip39');
const {hdkey} = require('ethereumjs-wallet');
const {getDynamoItem, getDynamoAllItems, putDynamoItem} = require('./aws.js');
const {getRedisItem, getRedisAllItems, parseRedisItems} = require('./redis.js');
const {getExt, makePromise} = require('./utils.js');
const Timer = require('./timer.js');
const {getStoreEntries, getChainNft, getAllWithdrawsDeposits} = require('./tokens.js');
const {getBlockchain} = require('./blockchain.js');
// const browserManager = require('./browser-manager.js');
const {accountKeys, ids, nftIndexName, redisPrefixes, mainnetSignatureMessage, cacheHostUrl} = require('./constants.js');
const {connect: redisConnect, getRedisClient} = require('./redis');
const ethereumJsUtil = require('./ethereumjs-util.js'); */

// const api = require('./api.js');
// const { _handleStorageRequest } = require('./routes/storage.js');
// const { _handleAccountsRequest } = require('./routes/accounts.js');
// const { _handlePreviewRequest } = require('./routes/preview.js')
const { worldManager, _handleWorldsRequest, _startWorldsRoute } = require('./routes/worlds.js');
let CERT = null;
let PRIVKEY = null;

const fullchainPath = './certs/fullchain.pem';
const privkeyPath = './certs/privkey.pem';
try {
  CERT = fs.readFileSync(fullchainPath);
} catch (err) {
  console.warn(`failed to load ${fullchainPath}`);
}
try {
  PRIVKEY = fs.readFileSync(privkeyPath);
} catch (err) {
  console.warn(`failed to load ${privkeyPath}`);
}

const PORT = parseInt(process.env.HTTP_PORT, 10) || 1111;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || 1112;

(async () => {

await worldManager.waitForLoad();

const _req = protocol => (req, res) => {
try {
  _handleWorldsRequest(req, res);
  return;

  res.statusCode = 404;
  res.end('host not found');
} catch(err) {
  console.warn(err.stack);

  res.statusCode = 500;
  res.end(err.stack);
}
};

const server = http.createServer(_req('http:'));
// server.on('upgrade', _ws('http:'));
const server2 = https.createServer({
  cert: CERT,
  key: PRIVKEY,
}, _req('https:'));
// server2.on('upgrade', _ws('https:'));

const _warn = err => {
  console.warn('uncaught: ' + err.stack);
};
process.on('uncaughtException', _warn);
process.on('unhandledRejection', _warn);

server.listen(PORT);
server2.listen(HTTPS_PORT);

console.log(`http://127.0.0.1:${PORT}`);
console.log(`https://127.0.0.1:${HTTPS_PORT}`);

})();