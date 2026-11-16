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
  await page.waitForTimeout(600);
  const nlBody = await page.content();
  await page.screenshot({ path: `${out}-newsletter-${name}.png`, fullPage: true });
  // API checks through the routed service (fixtures, no mailer, no flag).
  const cookie = (await ctx.cookies()).filter(c => c.name).map(c => c.name + '=' + c.value).join('; ');
  const subs = await service(new Request(`https://m.${site}/api/newsletter/subscribers`, { headers: { cookie } }));
  const subsJson = await subs.json().catch(() => null);
  const send = await service(new Request(`https://m.${site}/api/newsletter/send`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'fixture', confirm: 'SEND' }) }));
  const publicApi = await service(new Request(`https://blog.${site}/api/newsletter/subscribers`, { headers: { cookie } }));
  results[name] = { errs, cardVisible, nlPath: await page.evaluate(() => location.pathname), nlEditor: nlBody.includes('rt-editor') || nlBody.includes('manage'), subsStatus: subs.status, subsJson, sendStatus: send.status, publicApiStatus: publicApi.status, scrollOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) };
  await ctx.close();
}
// Public news host must not exist while newsletterPublic is false.
const newsHost = await service(new Request(`https://news.${site}/`));
results.newsHostStatus = newsHost.status;
console.log(JSON.stringify(results, null, 1));
await browser.close(); store.close();
