// Live private write-flow QA: save/reopen/preview/delete on prod, fixtures stay private, nothing published.
import { chromium } from 'playwright';
const site = 'philipp-paulik.de';
const email = process.env.QA_EMAIL, pw = process.env.QA_PW;
if (!email || !pw) { console.error('missing creds'); process.exit(1); }
const out = {};
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
const login = async (host, path) => {
  const ready = page.waitForResponse(r => r.url().includes('/api/session'), { timeout: 15000 }).catch(() => null);
  await page.goto(`https://${host}.${site}${path}`, { waitUntil: 'domcontentloaded' });
  await ready; // module executed (session probe fired), submit listener attached
  await page.waitForTimeout(400);
  if (await page.locator('#email').isVisible().catch(() => false)) {
    await page.locator('#email').fill(email); await page.locator('#password').fill(pw);
    const loggedIn = page.waitForResponse(r => r.url().includes('/api/login'), { timeout: 15000 }).catch(() => null);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await loggedIn;
  }
  await page.locator('#console').waitFor({ state: 'visible', timeout: 15000 });
};
const cookieHeader = async () => (await ctx.cookies()).filter(c => c.name).map(c => c.name + '=' + c.value).join('; ');

// --- lp: custom HTML/CSS/JS draft save + reopen + private preview + delete ---
await login('lp', '/manage');
await page.locator('#f-title').fill('QA LP privat');
await page.locator('#f-text').fill('Fallback Absatz.');
await page.locator('#f-custom-toggle').check();
await page.waitForSelector('#editor-host .monaco-editor, #editor-host .cm-editor', { timeout: 15000 });
await page.locator('#editor-host').click();
await page.keyboard.type('<p>QA HTML privat</p>');
await page.locator('#save').click();
await page.getByText('Gespeichert.', { exact: true }).waitFor({ timeout: 10000 });
const lpSlug = await page.locator('#f-slug').inputValue();
await page.locator('#items .item', { hasText: lpSlug }).getByRole('button', { name: 'Bearbeiten' }).click();
await page.waitForSelector('#editor-host .monaco-editor, #editor-host .cm-editor', { timeout: 15000 });
const lpReopened = (await page.locator('#editor-host').textContent()).includes('QA HTML privat');
const lpPreview = await page.goto(`https://lp.${site}/preview/${lpSlug}`, { waitUntil: 'domcontentloaded' });
out.lp = { slug: lpSlug, reopened: lpReopened, preview: lpPreview.status(), publicDraft: (await page.goto(`https://lp.${site}/${lpSlug}`)).status() };
await page.goto(`https://lp.${site}/manage`, { waitUntil: 'domcontentloaded' });
await page.locator('#console').waitFor({ state: 'visible', timeout: 15000 });
await page.locator('#items .item', { hasText: lpSlug }).getByRole('button', { name: 'Löschen' }).click();
await page.getByText('Gelöscht.', { exact: true }).waitFor({ timeout: 10000 });
out.lp.deleted = !(await page.locator('#items').textContent()).includes(lpSlug);

// --- blog: richtext draft save + reopen + private preview + delete ---
await login('blog', '/manage');
await page.locator('#f-title').fill('QA Beitrag privat');
await page.locator('#rt-editor').click();
await page.keyboard.type('Normal ');
await page.getByRole('button', { name: 'B', exact: true }).click();
await page.keyboard.type('fett');
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Liste' }).click();
await page.keyboard.type('Punkt eins');
await page.locator('#save').click();
await page.getByText('Gespeichert.', { exact: true }).waitFor({ timeout: 10000 });
const blogSlug = await page.locator('#f-slug').inputValue();
await page.locator('#items .item', { hasText: blogSlug }).getByRole('button', { name: 'Bearbeiten' }).click();
await page.waitForSelector('#rt-editor strong, #rt-editor b', { timeout: 10000 });
const blogReopened = (await page.locator('#rt-editor').textContent()).includes('Punkt eins');
const blogPreview = await page.goto(`https://blog.${site}/preview/${blogSlug}`, { waitUntil: 'domcontentloaded' });
out.blog = { slug: blogSlug, reopened: blogReopened, preview: blogPreview.status(), publicDraft: (await page.goto(`https://blog.${site}/${blogSlug}`)).status() };
await page.goto(`https://blog.${site}/manage`, { waitUntil: 'domcontentloaded' });
await page.locator('#console').waitFor({ state: 'visible', timeout: 15000 });
await page.locator('#items .item', { hasText: blogSlug }).getByRole('button', { name: 'Löschen' }).click();
await page.getByText('Gelöscht.', { exact: true }).waitFor({ timeout: 10000 });
out.blog.deleted = !(await page.locator('#items').textContent()).includes(blogSlug);

// --- m studio: private image upload + listed + private URL unreachable + delete ---
await login('m', '/');
await page.locator('#img-file').setInputFiles('/tmp/fixture.png');
await page.getByRole('button', { name: 'Hochladen' }).click();
await page.locator('#images .item').first().waitFor({ timeout: 15000 });
const filesRes = await page.evaluate(async () => (await fetch('/api/files', { credentials: 'same-origin' })).json());
const uploaded = (filesRes.files || filesRes).find(f => f.name === 'fixture.png' || (f.name || '').includes('fixture'));
let privateUrl = 'unknown';
if (uploaded) privateUrl = (await page.goto(`https://static.${site}/${uploaded.id}`)).status();
await page.goto(`https://m.${site}/`, { waitUntil: 'domcontentloaded' });
await page.locator('#console').waitFor({ state: 'visible', timeout: 15000 });
await page.locator('#images .item').first().getByRole('button', { name: 'Löschen' }).click();
await page.waitForTimeout(1200);
const afterFiles = await page.evaluate(async () => (await fetch('/api/files', { credentials: 'same-origin' })).json());
out.upload = { uploaded: !!uploaded, shared: uploaded ? !!uploaded.shared : null, privateUrlStatus: privateUrl, deleted: !(afterFiles.files || afterFiles).some(f => f.id === (uploaded || {}).id) };
await page.screenshot({ path: '/downloads/live-writeqa-studio.png', fullPage: true });

console.log(JSON.stringify(out, null, 1));
await browser.close();
