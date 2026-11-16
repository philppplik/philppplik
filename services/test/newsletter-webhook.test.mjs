import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../src/sqlite.mjs';
import { createNewsletter } from '../src/newsletter.mjs';
import { createService, passwordVerifier } from '../src/service.mjs';

const SECRET = 'whsec_' + Buffer.from('test-webhook-secret').toString('base64');
const NOW = 1763000000000;
const OWN_FROM = 'newsletter@news.philipp-paulik.de';

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
  const statusOf = async email => (await store.get('SELECT status FROM subscribers WHERE email=?', email))?.status;
  const count = async () => { await nl.init(); return Number((await store.get('SELECT count(*) AS total FROM subscribers')).total); };
  const event = (type, to, from = OWN_FROM) => JSON.stringify({ type, data: { email_id: 'e1', from, to: Array.isArray(to) ? to : [to] } });
  return { store, sent, nl, hook, add, statusOf, count, event };
}

test('webhook is dormant without a secret', async () => {
  const { nl } = setup({ webhookSecret: '' });
  const res = await nl.webhook(new Request('https://m.philipp-paulik.de/api/newsletter/resend-webhook', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 503);
});

test('bounce suppresses the address and excludes it from sends', async () => {
  const { hook, add, statusOf, nl, sent, event } = setup({ allowSend: true });
  await add('a@example.com');
  await add('b@example.com');
  const body = event('email.bounced', 'a@example.com');
  assert.equal((await hook(body)).status, 200);
  assert.equal(await statusOf('a@example.com'), 'bounced');
  const send = await nl.admin(new Request('https://m.philipp-paulik.de/api/newsletter/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'SEND', slug: 'x' }) }), new URL('https://m.philipp-paulik.de/api/newsletter/send'), async () => ({ subject: 'S', html: '<p>H</p>', text: 'H', preheader: null }));
  assert.equal(send.status, 200);
  assert.equal(sent.length, 1, 'only the still-active address is mailed');
  assert.equal(sent[0].to, 'b@example.com');
});

test('complaint suppresses the address', async () => {
  const { hook, add, statusOf, event } = setup();
  await add('c@example.com');
  assert.equal((await hook(event('email.complained', 'c@example.com'))).status, 200);
  assert.equal(await statusOf('c@example.com'), 'complained');
});

test('webhook rejects bad signatures and stale timestamps', async () => {
  const { hook, add, statusOf, event } = setup();
  await add('d@example.com');
  const body = event('email.bounced', 'd@example.com');
  assert.equal((await hook(body, { ...sign(body), 'svix-signature': 'v1,AAAA' })).status, 400);
  assert.equal((await hook(body, sign(body, 'msg_1', Math.floor(NOW / 1000) - 3600))).status, 400, 'older than 5 minutes');
  assert.equal(await statusOf('d@example.com'), 'active', 'nothing changed');
});

test('foreign-project events are acknowledged but never applied', async () => {
  const { hook, add, statusOf, event } = setup();
  await add('e@example.com');
  // Same Resend account, other project: valid signature, but sender is the PR domain.
  const res = await hook(event('email.bounced', 'e@example.com', 'newsletter@news.paulikreisch.de'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, ignored: 'foreign-sender' });
  assert.equal(await statusOf('e@example.com'), 'active', 'portfolio subscriber untouched');
});

test('a configured sender must match exactly', async () => {
  const { hook, add, statusOf, event } = setup({ from: OWN_FROM });
  await add('f@example.com');
  const res = await hook(event('email.bounced', 'f@example.com', 'other@news.philipp-paulik.de'));
  assert.deepEqual(await res.json(), { ok: true, ignored: 'foreign-sender' });
  assert.equal(await statusOf('f@example.com'), 'active');
  assert.equal((await hook(event('email.bounced', 'f@example.com', 'Philipp Paulik <newsletter@news.philipp-paulik.de>'))).status, 200);
  assert.equal(await statusOf('f@example.com'), 'bounced', 'display-name form of the same address matches');
});

test('unknown addresses are never created from provider events', async () => {
  const { hook, count, event } = setup();
  const before = await count();
  assert.equal((await hook(event('email.bounced', 'nobody@example.com'))).status, 200);
  assert.equal(await count(), before, 'no list import, no new rows');
});

test('replayed deliveries are idempotent', async () => {
  const { hook, add, statusOf, count, event } = setup();
  await add('g@example.com');
  const body = event('email.bounced', 'g@example.com');
  assert.equal((await hook(body)).status, 200);
  assert.equal((await hook(body)).status, 200, 'same event again is fine');
  assert.equal(await statusOf('g@example.com'), 'bounced');
  assert.equal(await count(), 1);
});

test('unrelated event types are acknowledged and ignored', async () => {
  const { hook, event } = setup();
  const res = await hook(event('email.delivered', 'x@example.com'));
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

test('studio host serves public unsubscribe only, never subscribe or confirm', async () => {
  const store = new Store();
  const verifier = passwordVerifier('local-test-fixture-not-a-real-secret', 'local-fixture');
  const nl = createNewsletter({ store, site: 'philipp-paulik.de', now: () => NOW, webhookSecret: SECRET });
  const service = createService({ store, sites: { 'philipp-paulik.de': { enabled: true, verifier } }, enabled: true, modern: true, newsletter: nl, newsletterPublic: false });
  const m = (path, method = 'GET', raw, headers = {}) => service(new Request('https://m.philipp-paulik.de' + path, { method, headers, body: raw }));
  assert.equal((await m('/unsubscribe?e=a@example.com&t=' + '0'.repeat(48))).status, 400, 'route is served (invalid token answered by the module)');
  assert.equal((await m('/confirm?e=a@example.com&t=' + '0'.repeat(48))).status, 404, 'no unrequested double-opt-in activation');
  assert.equal((await m('/subscribe', 'POST', '{}', { 'content-type': 'application/json' })).status, 404, 'public registration stays off');
  const body = JSON.stringify({ type: 'email.delivered', data: { to: [] } });
  assert.equal((await m('/api/newsletter/resend-webhook', 'POST', body, sign(body))).status, 200, 'webhook reachable before the session check');
  store.close();
});
