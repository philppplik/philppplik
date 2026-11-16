// Local visual QA for newsletter wiring: fixtures only, in-memory store, fake password.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { Store } from '../src/sqlite.mjs';
import { createService, passwordVerifier } from '../src/service.mjs';
import { createContentService } from '../src/content.mjs';
import { createNewsletter } from '../src/newsletter.mjs';
import { readSession } from '../src/sessions.mjs';
const site = 'philipp-paulik.de', pw = 'local-fixture-only-password-20+', pub = f => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const store = new Store();
const contentAssets = {}, assets = {};
for (const [n, t] of [['content.css', 'text/css'], ['content.js', 'text/javascript'], ['richtext.js', 'text/javascript']]) contentAssets['/' + n] = { body: pub(n), type: t };
for (const [n, t] of [['manage.css', 'text/css'], ['manage.js', 'text/javascript'], ['studio.js', 'text/javascript']]) assets['/' + n] = { body: pub(n), type: t };
const content = createContentService({ store, site, authenticate: async req => !!await readSession(req, store, site), managementHTML: pub('content.html'), managementAssets: contentAssets, vendorDir: new URL('../public/vendor', import.meta.url).pathname });
const newsletter = createNewsletter({ store, site });
const service = createService({ store, enabled: true, modern: true, sites: { [site]: { enabled: true, verifier: passwordVerifier(pw) } }, studioHTML: pub('studio.html'), managementHTML: pub('manage.html'), managementAssets: assets, content, newsletter, newsletterPublic: false });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const out = process.argv[2] || '/tmp/nl-qa';
const results = {};
for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route('https://**/*', async route => {
    const r = route.request(), u = new URL(r.url());
    if (!u.hostname.endsWith('.' + site)) return route.abort();
    const res = await service(new Request(r.url(), { method: r.method(), headers: r.headers(), body: r.postDataBuffer() ?? undefined }));
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`https://m.${site}/`);
  await page.locator('#email').fill('fixture@example.com'); await page.locator('#password').fill(pw);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.locator('#console').waitFor({ state: 'visible' });
  const cardVisible = await page.locator('#nl').count();
  await page.screenshot({ path: `${out}-studio-${name}.png`, fullPage: true });
  await page.goto(`https://m.${site}/newsletter`);
  await page.locator('#console').waitFor({ state: 'visible' });
  // Form: Betreff label, Preheader visible, send card locked, honest publish label.
  const titleLabel = await page.locator('label[for="f-title"]').textContent();
  const preheaderVisible = await page.locator('#preheader-field').isVisible();
  const publishLabel = (await page.locator('#publish').textContent()).trim();
  const sendCardVisible = await page.locator('#send-card').isVisible();
  const sendBtnDisabled = await page.locator('#send-now').isDisabled();
  const sendBtnText = (await page.locator('#send-now').textContent()).trim();
  // Save a fixture draft (plaintext only), then mark ready.
  await page.locator('#f-title').fill(`November-News (${name} Fixture)`);
  await page.locator('#f-preheader').fill('Vorschau im Postfach (Fixture)');
  await page.locator('#f-text').fill('Erster Absatz.\n\nZweiter Absatz.');
  await page.locator('#save').click();
  await page.getByText('Gespeichert.', { exact: true }).waitFor();
  const slug = await page.locator('#f-slug').inputValue();
  await page.locator('#publish').click();
  await page.getByText('Als versandbereit markiert.', { exact: false }).waitFor();
  const pill = (await page.locator('#editor-status').textContent()).trim();
  const sendStatus = (await page.locator('#send-status').textContent()).trim();
  await page.screenshot({ path: `${out}-newsletter-${name}.png`, fullPage: true });
  // Private preview of the ready draft.
  await page.goto(`https://m.${site}/preview/${slug}`);
  await page.waitForTimeout(400);
  const previewBody = await page.content();
  await page.screenshot({ path: `${out}-preview-${name}.png`, fullPage: true });
  // API checks through the routed service (fixtures, no mailer, no flag).
  const cookie = (await ctx.cookies()).filter(c => c.name).map(c => c.name + '=' + c.value).join('; ');
  const subs = await service(new Request(`https://m.${site}/api/newsletter/subscribers`, { headers: { cookie } }));
  const send = await service(new Request(`https://m.${site}/api/newsletter/send`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ slug, confirm: 'SEND' }) }));
  const publicApi = await service(new Request(`https://blog.${site}/api/newsletter/subscribers`, { headers: { cookie } }));
  results[name] = { errs, cardVisible, titleLabel, preheaderVisible, publishLabel, pill, sendCardVisible, sendBtnDisabled, sendBtnText, sendStatus: sendStatus.slice(0, 120), slug, previewOk: previewBody.includes('Entwurfsvorschau') || previewBody.includes('Erster Absatz'), subsStatus: subs.status, sendStatusCode: send.status, publicApiStatus: publicApi.status, scrollOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) };
  await ctx.close();
}
const newsHost = await service(new Request(`https://news.${site}/`));
results.newsHostStatus = newsHost.status;
console.log(JSON.stringify(results, null, 1));
await browser.close(); store.close();
