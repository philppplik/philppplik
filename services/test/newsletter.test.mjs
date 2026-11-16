import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/sqlite.mjs';
import { createNewsletter } from '../src/newsletter.mjs';

function setup(opts = {}) {
  const store = new Store(), sent = [];
  const mailer = { send: async m => { sent.push(m); } };
  const nl = createNewsletter({ store, site: 'philipp-paulik.de', mailer, ...opts });
  const pub = (path, method = 'GET', data) => nl.publicRoute(new Request('https://news.philipp-paulik.de' + path, { method, headers: data ? { 'content-type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined }), new URL('https://news.philipp-paulik.de' + path));
  const adm = (path, method = 'GET', data, draft = async () => ({ subject: 'Hallo', html: '<p>Hallo</p>', text: 'Hallo', preheader: null })) => nl.admin(new Request('https://news.philipp-paulik.de' + path, { method, headers: { 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined }), new URL('https://news.philipp-paulik.de' + path), draft);
  return { store, sent, pub, adm };
}
const tokenUrl = m => new URL(m.text.match(/https:\/\/\S+/)[0]);

test('double opt-in: pending until confirmed, same answer for known address', async () => {
  const x = setup();
  assert.equal((await x.pub('/subscribe', 'POST', { email: 'nope' })).status, 400);
  assert.equal((await x.pub('/subscribe', 'POST', { email: 'A@Example.com' })).status, 202);
  assert.equal(x.sent.length, 1);
  assert.equal((await (await x.adm('/api/newsletter/subscribers')).json()).counts.pending, 1);
  const u = tokenUrl(x.sent[0]);
  assert.equal((await x.pub('/confirm?e=a@example.com&t=' + '0'.repeat(48))).status, 400);
  assert.equal((await x.pub(u.pathname + u.search)).status, 200);
  assert.equal((await (await x.adm('/api/newsletter/subscribers')).json()).counts.active, 1);
  assert.equal((await x.pub('/subscribe', 'POST', { email: 'a@example.com' })).status, 202);
  assert.equal(x.sent.length, 1, 'active address gets no new mail');
});

test('unsubscribe: GET only asks, POST removes', async () => {
  const x = setup();
  await x.pub('/subscribe', 'POST', { email: 'b@example.com' });
  const c = tokenUrl(x.sent[0]); await x.pub(c.pathname + c.search);
  const u = c.pathname.replace('confirm', 'unsubscribe') + c.search;
  assert.equal((await x.pub(u)).status, 200);
  assert.equal((await (await x.adm('/api/newsletter/subscribers')).json()).counts.active, 1);
  assert.equal((await x.pub(u, 'POST')).status, 200);
  const counts = (await (await x.adm('/api/newsletter/subscribers')).json()).counts;
  assert.equal(counts.unsubscribed, 1); assert.equal(counts.active ?? 0, 0);
});

test('sending is hard-gated: off by default, needs flag and explicit confirmation', async () => {
  let x = setup();
  assert.equal((await x.adm('/api/newsletter/send', 'POST', { confirm: 'SEND', slug: 'a', subject: 'x', test: 'me@example.com' })).status, 403);
  assert.equal(x.sent.length, 0);
  x = setup({ allowSend: true });
  assert.equal((await x.adm('/api/newsletter/send', 'POST', { slug: 'a', subject: 'x', test: 'me@example.com' })).status, 400);
  assert.equal(x.sent.length, 0);
  const r = await x.adm('/api/newsletter/send', 'POST', { confirm: 'SEND', slug: 'a', subject: 'Test', test: 'me@example.com' });
  assert.equal((await r.json()).sent, 1);
  assert.match(x.sent[0].html, /Abmelden/); assert.ok(x.sent[0].headers['List-Unsubscribe']);
  const none = setup({ allowSend: true });
  assert.equal((await none.pub('/subscribe', 'POST', { email: 'c@example.com' })).status, 202);
});

test('no mailer: signup is off', async () => {
  const x = setup({ mailer: null });
  assert.equal((await x.pub('/subscribe', 'POST', { email: 'd@example.com' })).status, 503);
});
