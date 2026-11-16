import test from 'node:test';
import assert from 'node:assert/strict';
import { createResendMailer } from '../src/resend-mailer.mjs';
import { Store } from '../src/sqlite.mjs';
import { createNewsletter } from '../src/newsletter.mjs';

test('resend mailer stays dormant without an api key', () => {
  assert.equal(createResendMailer({ apiKey: '', from: 'a@b.c' }), null);
});

test('resend mailer posts the message to the api', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  const mailer = createResendMailer({ apiKey: 're_test', from: 'News <news@example.com>', fetchImpl });
  await mailer.send({ to: 'x@y.z', subject: 'Hallo', html: '<p>Hallo</p>', text: 'Hallo', headers: { 'List-Unsubscribe': '<https://example.com/u>' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer re_test');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, { from: 'News <news@example.com>', to: 'x@y.z', subject: 'Hallo', html: '<p>Hallo</p>', text: 'Hallo', headers: { 'List-Unsubscribe': '<https://example.com/u>' } });
});

test('resend mailer throws on api errors', async () => {
  const mailer = createResendMailer({ apiKey: 're_test', from: 'a@b.c', fetchImpl: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(() => mailer.send({ to: 'x@y.z', subject: 's', html: 'h', text: 't' }), /403/);
});

test('wired newsletter keeps sends gated while mailer is ready', async () => {
  const store = new Store(), sent = [];
  const mailer = createResendMailer({ apiKey: 're_test', from: 'News <news@example.com>', fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true }; } });
  const nl = createNewsletter({ store, site: 'philipp-paulik.de', mailer, allowSend: false, from: 'News <news@example.com>' });
  const adm = (path, method, data, draft) => nl.admin(new Request('https://news.philipp-paulik.de' + path, { method, headers: { 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined }), new URL('https://news.philipp-paulik.de' + path), draft);
  await adm('/api/newsletter/targets', 'POST', { email: 't@example.com', name: 'T', token: 'tok1' });
  const res = await adm('/api/newsletter/send', 'POST', { confirm: true }, async () => ({ subject: 'S', html: '<p>H</p>', text: 'H', preheader: null }));
  assert.equal(res.status, 403);
  assert.equal(sent.length, 0, 'no mail leaves while allowSend is off');
});
