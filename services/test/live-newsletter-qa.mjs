// Live post-deploy QA against production: real login, private newsletter save/preview flow.
// The fixture draft is private (role news is never publicly routed) and is deleted at the end.
import { chromium } from 'playwright';
const site = 'philipp-paulik.de';
const email = process.env.QA_EMAIL, pw = process.env.QA_PW;
if (!email || !pw) { console.error('missing QA_EMAIL/QA_PW'); process.exit(1); }
const out = process.argv[2] || '/tmp/live-qa';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const results = {};
for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(`https://m.${site}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email); await page.locator('#password').fill(pw);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.locator('#console').waitFor({ state: 'visible', timeout: 15000 });
  await page.screenshot({ path: `${out}-studio-${name}.png`, fullPage: true });
  await page.goto(`https://m.${site}/newsletter`, { waitUntil: 'domcontentloaded' });
  await page.locator('#console').waitFor({ state: 'visible', timeout: 15000 });
  const titleLabel = await page.locator('label[for="f-title"]').textContent();
  const preheaderVisible = await page.locator('#preheader-field').isVisible();
  const publishLabel = (await page.locator('#publish').textContent()).trim();
  const sendBtnDisabled = await page.locator('#send-now').isDisabled();
  const sendBtnText = (await page.locator('#send-now').textContent()).trim();
  // Private save flow: fixture draft, mark ready, preview, then delete.
  await page.locator('#f-title').fill(`QA-Entwurf privat (${name})`);
  await page.locator('#f-preheader').fill('QA Vorschau');
  await page.locator('#f-text').fill('Privater QA-Absatz.');
  await page.locator('#save').click();
  await page.getByText('Gespeichert.', { exact: true }).waitFor({ timeout: 10000 });
  const slug = await page.locator('#f-slug').inputValue();
  await page.locator('#publish').click();
  await page.getByText('Als versandbereit markiert.', { exact: false }).waitFor({ timeout: 10000 });
  const pill = (await page.locator('#editor-status').textContent()).trim();
  await page.screenshot({ path: `${out}-newsletter-${name}.png`, fullPage: true });
  const prev = await page.goto(`https://m.${site}/preview/${slug}`, { waitUntil: 'domcontentloaded' });
  const previewOk = prev.status() === 200 && (await page.content()).includes('Privater QA-Absatz');
  await page.screenshot({ path: `${out}-preview-${name}.png`, fullPage: true });
  // Cleanup: delete the fixture draft again.
  await page.goto(`https://m.${site}/newsletter`, { waitUntil: 'domcontentloaded' });
  await page.locator('#console').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#items .item', { hasText: slug }).getByRole('button', { name: 'Löschen' }).click();
  await page.getByText('Gelöscht.', { exact: true }).waitFor({ timeout: 10000 });
  const remaining = await page.locator('#items').textContent();
  results[name] = { errs, titleLabel, preheaderVisible, publishLabel, pill, sendBtnDisabled, sendBtnText, slug, previewOk, cleanedUp: !remaining.includes(slug), scrollOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) };
  await ctx.close();
}
// Gating checks against production (no session needed for the negative ones).
const sendAnon = await fetch(`https://m.${site}/api/newsletter/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'x', confirm: 'SEND' }) });
results.sendAnonStatus = sendAnon.status;
const blogApi = await fetch(`https://blog.${site}/api/newsletter/subscribers`);
results.publicApiStatus = blogApi.status;
let newsHost = 'no-dns';
try { const r = await fetch(`https://news.${site}/`); newsHost = r.status; } catch (e) { newsHost = 'unreachable'; }
results.newsHost = newsHost;
console.log(JSON.stringify(results, null, 1));
await browser.close();
