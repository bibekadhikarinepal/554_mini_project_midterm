'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createServer } = require('../src/server');

test('configured responses, local counter, health, and fresh instance', async () => {
  const server = createServer({serviceName:'test-service', message:'test-message'});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const first = await fetch(base + '/');
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.service, 'test-service');
    assert.equal(body.message, 'test-message');
    assert.equal(typeof body.hostname, 'string');
    assert.equal(body.requestCount, 1);
    const health = await fetch(base + '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {status:'ok'});
    assert.equal((await (await fetch(base + '/')).json()).requestCount, 2);
    const missing = await fetch(base + '/missing');
    assert.equal(missing.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  const fresh = createServer();
  fresh.listen(0, '127.0.0.1');
  await once(fresh, 'listening');
  try {
    const response = await fetch('http://127.0.0.1:' + fresh.address().port + '/');
    assert.equal((await response.json()).requestCount, 1);
  } finally {
    await new Promise(resolve => fresh.close(resolve));
  }
});

test('readiness toggle fails /health only while the marker file exists', async () => {
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cs554-')), 'not-ready');
  const server = createServer({notReadyFile: marker});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    fs.writeFileSync(marker, '');
    const notReady = await fetch(base + '/health');
    assert.equal(notReady.status, 503);
    assert.deepEqual(await notReady.json(), {status:'not-ready'});
    assert.equal((await fetch(base + '/')).status, 200);
    fs.rmSync(marker);
    assert.equal((await fetch(base + '/health')).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(path.dirname(marker), {recursive: true, force: true});
  }
});
