// Newsletter subscribers with double opt-in and a working unsubscribe. Dormant until wired in and enabled:
// sending needs a mailer (e.g. Resend), an explicit allowSend flag and a per-call confirmation. Nothing is sent by default.
import { randomBytes, createHash } from 'node:crypto';
const digest = v => createHash('sha256').update(v).digest('hex');
const EMAIL = /^[^\s@<>"']{1,64}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const page = (status, title, text) => new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font:16px/1.6 system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px"><h1 style="font-size:22px">${title}</h1><p>${text}</p></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" } });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export const newsletterSchema = `CREATE TABLE IF NOT EXISTS subscribers(site TEXT, email TEXT, status TEXT NOT NULL, token_digest TEXT NOT NULL, created BIGINT NOT NULL, confirmed BIGINT, unsubscribed BIGINT, PRIMARY KEY(site,email));`;

export function createNewsletter({ store, site, mailer = null, allowSend = false, now = () => Date.now(), maxPending = 500, from = '' }) {
  let ready = false;
  const init = async () => { if (!ready) { await store.run(newsletterSchema); ready = true; } };
  const base = `https://news.${site}`;
  const link = (kind, email, token) => `${base}/${kind}?e=${encodeURIComponent(email)}&t=${token}`;
  async function subscribe(req) {
    if (!mailer) return json(503, { error: 'Anmeldung ist noch nicht aktiviert.' });
    let input; try { input = await req.json(); } catch { return json(400, { error: 'Ungültige Anfrage.' }); }
    const email = String(input?.email || '').trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return json(400, { error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
    const pending = Number((await store.get("SELECT count(*) AS total FROM subscribers WHERE site=? AND status='pending'", site)).total);
    const old = await store.get('SELECT status FROM subscribers WHERE site=? AND email=?', site, email);
    // Same answer for new, pending and active addresses: no list enumeration. Active addresses get no new mail.
    const answer = json(202, { ok: true, message: 'Wenn die Adresse gültig ist, kommt gleich eine Bestätigungsmail.' });
    if (old?.status === 'active') return answer;
    if (!old && pending >= maxPending) return answer;
    const token = randomBytes(24).toString('hex');
    await store.run("INSERT INTO subscribers(site,email,status,token_digest,created) VALUES(?,?,?,?,?) ON CONFLICT(site,email) DO UPDATE SET status='pending',token_digest=excluded.token_digest,created=excluded.created", site, email, 'pending', digest(token), now());
    await mailer.send({ to: email, subject: 'Bitte bestätige deine Anmeldung', text: `Bitte bestätige deine Newsletter-Anmeldung:\n${link('confirm', email, token)}\n\nWenn du das nicht warst, ignoriere diese Mail.`, html: `<p>Bitte bestätige deine Newsletter-Anmeldung:</p><p><a href="${link('confirm', email, token)}">Anmeldung bestätigen</a></p><p>Wenn du das nicht warst, ignoriere diese Mail.</p>` });
    return answer;
  }
  async function verify(u) {
    const email = (u.searchParams.get('e') || '').toLowerCase(), token = u.searchParams.get('t') || '';
    if (!EMAIL.test(email) || !/^[a-f0-9]{48}$/.test(token)) return null;
    const row = await store.get('SELECT status,token_digest FROM subscribers WHERE site=? AND email=?', site, email);
    return row && row.token_digest === digest(token) ? { email, row } : null;
  }
  async function publicRoute(req, u) {
    await init();
    if (req.method === 'POST' && u.pathname === '/subscribe') return subscribe(req);
    if (u.pathname === '/confirm' && req.method === 'GET') {
      const v = await verify(u);
      if (!v) return page(400, 'Link ungültig', 'Dieser Bestätigungslink ist ungültig oder abgelaufen.');
      if (v.row.status === 'pending') await store.run("UPDATE subscribers SET status='active',confirmed=? WHERE site=? AND email=?", now(), site, v.email);
      return page(200, 'Anmeldung bestätigt', 'Danke. Du bekommst künftig den Newsletter. Jede Mail enthält einen Abmelde-Link.');
    }
    if (u.pathname === '/unsubscribe') {
      const v = await verify(u);
      if (!v) return page(400, 'Link ungültig', 'Dieser Abmelde-Link ist ungültig.');
      // GET shows a confirm button (mail scanners prefetch links); POST (also one-click List-Unsubscribe) removes the address.
      if (req.method === 'POST') { await store.run("UPDATE subscribers SET status='unsubscribed',unsubscribed=? WHERE site=? AND email=?", now(), site, v.email); return page(200, 'Abgemeldet', 'Du bekommst keinen Newsletter mehr.'); }
      if (req.method === 'GET') return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Abmelden</title></head><body style="font:16px/1.6 system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px"><h1 style="font-size:22px">Newsletter abmelden?</h1><form method="post"><button style="font:inherit;padding:8px 16px">Ja, abmelden</button></form></body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" } });
    }
    return null;
  }
  // Authenticated admin API (session and CSRF are checked by the caller).
  // getDraft(slug) resolves a send-ready draft to {subject, html, text, preheader} or null.
  async function admin(req, u, getDraft) {
    await init();
    if (req.method === 'GET' && u.pathname === '/api/newsletter/subscribers') {
      const rows = await store.all('SELECT status,count(*) AS total FROM subscribers WHERE site=? GROUP BY status', site);
      return json(200, { counts: Object.fromEntries(rows.map(r => [r.status, Number(r.total)])), sendEnabled: !!(allowSend && mailer) });
    }
    if (req.method === 'POST' && u.pathname === '/api/newsletter/send') {
      // Hard gate: real sending needs a mailer, the allowSend flag and an explicit confirmation in the request.
      if (!allowSend || !mailer) return json(403, { error: 'Versand ist nicht freigegeben.' });
      let input; try { input = await req.json(); } catch { return json(400, { error: 'Ungültige Anfrage.' }); }
      if (input?.confirm !== 'SEND') return json(400, { error: 'Bestätigung fehlt.' });
      const draft = await getDraft(String(input.slug || ''));
      const subject = String(input.subject || draft?.subject || '').slice(0, 200);
      if (!subject || !draft?.html) return json(400, { error: 'Betreff oder Newsletter fehlt (der Entwurf muss zum Versand bereit sein).' });
      // Owner-authored draft fields; the preheader is escaped because it lands inside the HTML body.
      const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      const preheader = draft.preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(draft.preheader)}</div>` : '';
      const html = preheader + draft.html, text = draft.text || '';
      const test = typeof input.test === 'string' ? input.test.trim().toLowerCase() : '';
      const targets = test ? [{ email: test, token: null }] : (await store.all("SELECT email FROM subscribers WHERE site=? AND status='active'", site));
      let sent = 0;
      for (const t of targets) {
        const token = randomBytes(24).toString('hex');
        if (!test) await store.run('UPDATE subscribers SET token_digest=? WHERE site=? AND email=?', digest(token), site, t.email);
        const unsub = test ? `${base}/unsubscribe` : link('unsubscribe', t.email, token);
        await mailer.send({ to: t.email, subject, html: html + `<p style="font-size:12px;color:#666"><a href="${unsub}">Abmelden</a></p>`, text: `${text}${text ? '\n\n' : ''}Abmelden: ${unsub}`, headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
        sent++;
      }
      return json(200, { sent, test: !!test });
    }
    return null;
  }
  return { publicRoute, admin, init };
}
