import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../src/sqlite.mjs';
import { createNewsletter } from '../src/newsletter.mjs';

const SECRET = 'whsec_' + Buffer.from('test-webhook-secret').toString('base64');
const NOW = 1763000000000;

function sign(body, id = 'msg_1', ts = Math.floor(NOW / 1000)) {
  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}`, 'content-type': 'application/json' };
}

function setup(opts = {}) {
  const store = new Store(), sent = [];
  const mailer = { send: async m => { sent.push(m); } };
  const nl = createNewsletter({ store, site: 'philipp-paulik.de', mailer, now: () => NOW, webhookSecret: SECRET, ...opts });
  const hook = (body, headers = sign(body)) => nl.webhook(new Request('https://m.philipp-paulik.de/api/newsletter/resend-webhook', { method: 'POST', headers, body }));
  const add = async (email, status = 'active') => { await nl.init(); await store.run("INSERT INTO subscribers VALUES(?,?,?,?,?,?,?)", 'philipp-paulik.de', email, status, 'x'.repeat(64), NOW, NOW, null); };
  const statusOf = async email => (await store.get('SELECT status FROM subscribers WHERE email=?', email)).status;
  return { store, sent, nl, hook, add, statusOf };
}

test('webhook is dormant without a secret', async () => {
  const { nl } = setup({ webhookSecret: '' });
  const res = await nl.webhook(new Request('https://m.philipp-paulik.de/api/newsletter/resend-webhook', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 503);
});

test('bounce suppresses the address and excludes it from sends', async () => {
  const { hook, add, statusOf, nl, sent } = setup({ allowSend: true });
  await add('a@example.com');
  await add('b@example.com');
  const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 'e1', to: ['a@example.com'] } });
  const res = await hook(body);
  assert.equal(res.status, 200);
  assert.equal(await statusOf('a@example.com'), 'bounced');
  const send = await nl.admin(new Request('https://m.philipp-paulik.de/api/newsletter/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'SEND', slug: 'x' }) }), new URL('https://m.philipp-paulik.de/api/newsletter/send'), async () => ({ subject: 'S', html: '<p>H</p>', text: 'H', preheader: null }));
  assert.equal(send.status, 200);
  assert.equal(sent.length, 1, 'only the still-active address is mailed');
  assert.equal(sent[0].to, 'b@example.com');
});

test('complaint suppresses the address', async () => {
  const { hook, add, statusOf } = setup();
  await add('c@example.com');
  const body = JSON.stringify({ type: 'email.complained', data: { email_id: 'e2', to: ['c@example.com'] } });
  assert.equal((await hook(body)).status, 200);
  assert.equal(await statusOf('c@example.com'), 'complained');
});

test('webhook rejects bad signatures and stale timestamps', async () => {
  const { hook, add, statusOf } = setup();
  await add('d@example.com');
  const body = JSON.stringify({ type: 'email.bounced', data: { to: ['d@example.com'] } });
  assert.equal((await hook(body, { ...sign(body), 'svix-signature': 'v1,AAAA' })).status, 400);
  assert.equal((await hook(body, sign(body, 'msg_1', Math.floor(NOW / 1000) - 3600))).status, 400, 'older than 5 minutes');
  assert.equal(await statusOf('d@example.com'), 'active', 'nothing changed');
});

test('unrelated event types are acknowledged and ignored', async () => {
  const { hook } = setup();
  const body = JSON.stringify({ type: 'email.delivered', data: { to: ['x@example.com'] } });
  const res = await hook(body);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, ignored: 'email.delivered' });
});

test('confirm and unsubscribe links use the configured public base', async () => {
  const { sent, nl } = setup({ allowSend: true, publicBase: 'https://m.philipp-paulik.de' });
  const pub = (path, data) => nl.publicRoute(new Request('https://m.philipp-paulik.de' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }), new URL('https://m.philipp-paulik.de' + path));
  await pub('/subscribe', { email: 'new@example.com' });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /https:\/\/m\.philipp-paulik\.de\/confirm\?e=/, 'double-opt-in link points at the reachable base');
});
