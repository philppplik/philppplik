// Build: node site/src/build.mjs <outdir>  -> DE at /, EN at /en/, plus sitemap, robots, llms.txt, 404
import { studioWork } from './studio-work.mjs';
import fs from 'node:fs';
const OUT = process.argv[2] || 'out';
const c = JSON.parse(fs.readFileSync(new URL('./content.json', import.meta.url), 'utf8'));
const mon = JSON.parse(fs.readFileSync(new URL('./monetization.json', import.meta.url), 'utf8'));
const s = c.site, L = s.links;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const today = new Date().toISOString().slice(0, 10);
const words = (t) => t.split(' ').map((w) => `<span class="w">${esc(w)}</span>`).join(' ');
const URLS = { de: s.url, en: s.url + 'en/' };
const sameAs = [L.github, L.x, L.instagram, L.youtube, L.linkedin, L.npm, L.hob, L.wikidata];
fs.mkdirSync(OUT + '/en', { recursive: true });
fs.mkdirSync(OUT + '/assets', { recursive: true });
fs.cpSync(new URL('./monetization', import.meta.url), OUT + '/assets/monetization', { recursive: true });

const imageVariant = (image, width) => image.replace(/\.jpg$/, `-${width}.jpg`);

/* Consent-Panel + Analytics-Einbindung (pp). Texte DE/EN, keine Fremd-Assets. */
const PP = {
  de: {
    h: 'Deine Privatsphäre.',
    intro: 'Du entscheidest, ob Statistik geladen wird. Ohne deine Zustimmung bleibt sie aus.',
    legend: 'Wofür dürfen Daten genutzt werden?',
    nec: 'Notwendig', necSub: 'Seite und Datenschutzauswahl. Kein Tracking.',
    stat: 'Statistik', statSub: 'Google Analytics 4 (Google Ireland / Google LLC): Seitenaufrufe, Lesetiefe und Herkunft als Domain, Cookies bis 180 Tage; Datenübermittlung in die USA möglich. Nur mit Zustimmung.',
    ads: 'Werbung', adsSub: 'Derzeit nicht im Einsatz.',
    reject: 'Alle ablehnen', all: 'Alle verfügbaren akzeptieren', save: 'Auswahl speichern',
    links: '<a href="/datenschutz/">Datenschutz</a> · <a href="/impressum/">Impressum</a>',
    note: 'Ohne Auswahl bleibt die Statistik aus. Jederzeit im Fußbereich änderbar.',
    footLine: 'Statistik nur mit deiner Einwilligung. Details im <a href="/datenschutz/">Datenschutz</a>.',
    settings: 'Datenschutzeinstellungen', privacy: 'Datenschutz', privacyHref: '/datenschutz/'
  },
  en: {
    h: 'Your privacy.',
    intro: 'You decide whether analytics is loaded. Without your consent it stays off.',
    legend: 'What may data be used for?',
    nec: 'Necessary', necSub: 'Site and privacy choice. No tracking.',
    stat: 'Statistics', statSub: 'Google Analytics 4 (Google Ireland / Google LLC): page views, reading depth and origin as domain, cookies up to 180 days; transfer to the USA possible. Only with consent.',
    ads: 'Advertising', adsSub: 'Currently not in use.',
    reject: 'Reject all', all: 'Accept all available', save: 'Save selection',
    links: '<a href="/en/privacy/">Privacy</a> · <a href="/impressum/">Imprint</a>',
    note: 'Without a choice, analytics stays off. Adjustable anytime in the footer.',
    footLine: 'Analytics only with your consent. Details in the <a href="/en/privacy/">privacy policy</a>.',
    settings: 'Privacy settings', privacy: 'Privacy', privacyHref: '/en/privacy/'
  }
};
const consentPanel = (lang) => { const x = PP[lang]; return `
<aside class="pp-consent" id="pp-consent" role="dialog" aria-modal="true" aria-labelledby="pp-consent-h" hidden>
  <h2 id="pp-consent-h">${x.h}</h2>
  <p>${x.intro}</p>
  <fieldset>
    <legend>${x.legend}</legend>
    <label><input type="checkbox" checked disabled><span>${x.nec}<small>${x.necSub}</small></span></label>
    <label><input type="checkbox" id="pp-statistics"><span>${x.stat}<small>${x.statSub}</small></span></label>
    <label><input type="checkbox" id="pp-advertising" disabled><span>${x.ads}<small>${x.adsSub}</small></span></label>
  </fieldset>
  <p class="pp-muted" id="pp-consent-status" role="status"></p>
  <div class="pp-consent-actions">
    <button type="button" data-consent="reject">${x.reject}</button>
    <button type="button" data-consent="save">${x.save}</button>
    <button type="button" data-consent="all">${x.all}</button>
  </div>
  <p class="pp-muted">${x.links}</p>
  <p class="pp-muted">${x.note}</p>
</aside>`; };
const consentHead = (P) => `<link rel="stylesheet" href="${P}assets/monetization/consent.css">`;
const consentScripts = (P, lang) => `
<script type="application/json" id="pp-monetization-config">${JSON.stringify(mon)}</script>
${consentPanel(lang)}
<script src="${P}assets/monetization/consent.js" defer></script>`;
function page(lang) {
  const t = c.i18n[lang], P = lang === 'de' ? '' : '../', url = URLS[lang], other = lang === 'de' ? 'en' : 'de';
  const proj = (p) => ({ ...p, ...p[lang] });
  const projects = c.projects.map(proj);

  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': s.url + '#website', url: s.url, name: s.name + ' Portfolio', inLanguage: ['de-DE', 'en'], publisher: { '@id': s.url + '#person' } },
      { '@type': 'ProfilePage', '@id': url + '#webpage', url, name: t.title, description: t.description, inLanguage: lang === 'de' ? 'de-DE' : 'en', isPartOf: { '@id': s.url + '#website' }, about: { '@id': s.url + '#person' }, mainEntity: { '@id': s.url + '#person' }, primaryImageOfPage: { '@id': s.url + '#hero-photo' }, dateModified: today, breadcrumb: { '@id': url + '#crumbs' } },
      { '@type': 'ImageObject', '@id': s.url + '#hero-photo', url: s.url + s.photo, contentUrl: s.url + s.photo, width: 900, height: 900, caption: t.hero.photoAlt, creditText: s.name, representativeOfPage: true },
      { '@type': 'ImageObject', '@id': s.url + '#hero-photo-16x9', url: s.url + 'assets/og.jpg', contentUrl: s.url + 'assets/og.jpg', width: 1200, height: 630, caption: t.ogAlt, creditText: s.name },
      { '@type': 'ImageObject', '@id': s.url + '#about-photo', url: s.url + s.aboutPhoto, contentUrl: s.url + s.aboutPhoto, width: 1254, height: 1254, caption: t.about.photoAlt, creditText: s.name },
      { '@type': 'Person', '@id': s.url + '#person', name: s.name, alternateName: s.handle, url: s.url, mainEntityOfPage: { '@id': url + '#webpage' }, image: [{ '@id': s.url + '#hero-photo' }, { '@id': s.url + '#about-photo' }], email: undefined, jobTitle: lang === 'de' ? 'KI-Pionier und KI-Stratege, Webdesigner, UI/UX-Designer, Software Engineer, Autor' : 'AI Pioneer and Strategist, Web Designer, UI/UX Designer, Software Engineer, Author', description: t.description, knowsLanguage: ['de', 'en'], knowsAbout: ['AI Strategy', 'Artificial Intelligence', 'AI Agents', 'Model Context Protocol', 'Web Design', 'UI/UX Design', 'Software Engineering', 'TypeScript', 'Rust', 'Authoring'], sameAs, subjectOf: { '@id': s.url + '#projects' } },
      { '@type': 'ItemList', '@id': s.url + '#projects', name: lang === 'de' ? 'Projekte von Philipp Paulik' : 'Projects by Philipp Paulik', itemListElement: projects.map((p, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'SoftwareSourceCode', name: p.name, description: p.desc, codeRepositoryUrl: p.repo || p.url, url: p.url, programmingLanguage: p.lang, author: { '@id': s.url + '#person' } } })) },
      { '@type': 'ItemList', '@id': s.url + '#sites', name: lang === 'de' ? 'Seiten von Philipp Paulik' : 'Sites by Philipp Paulik', itemListElement: t.sites.items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'WebSite', name: x.name, url: x.url, description: x.desc, inLanguage: 'de', publisher: { '@id': s.url + '#person' } } })) },
      { '@type': 'FAQPage', '@id': url + '#faq', mainEntity: t.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
      { '@type': 'BreadcrumbList', '@id': url + '#crumbs', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Portfolio', item: url }] }
    ]
  };

  const faq = t.faq.map((f) => `<details class="reveal"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  const social = [['GitHub', L.github], ['X', L.x], ['Instagram', L.instagram], ['YouTube', L.youtube], ['LinkedIn', L.linkedin], ['npm', L.npm]].map(([n, h]) => `<li><a href="${esc(h)}" rel="me noopener">${esc(n)}</a></li>`).join('');

  const label = (de,en) => lang === 'de' ? de : en;
  const inquiry = 'mailto:' + s.email + '?subject=' + encodeURIComponent(label('Projektanfrage','Project enquiry'));
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(t.title)}</title>
<meta name="description" content="${esc(t.description)}">
<meta name="author" content="${esc(s.name)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="theme-color" content="#f7f6f1">
<meta name="color-scheme" content="light">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="de" href="${URLS.de}">
<link rel="alternate" hreflang="en" href="${URLS.en}">
<link rel="alternate" hreflang="x-default" href="${URLS.de}">
<link rel="alternate" type="text/plain" href="${s.url}llms.txt" title="LLM-readable summary">
<link rel="icon" href="${P}assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="${P}favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="${P}assets/apple-touch-icon.png">
<link rel="sitemap" type="application/xml" href="${s.url}sitemap.xml">
<meta property="og:type" content="profile">
<meta property="og:locale" content="${t.ogLocale}">
<meta property="og:locale:alternate" content="${c.i18n[other].ogLocale}">
<meta property="og:site_name" content="${esc(s.name)}">
<meta property="og:title" content="${esc(t.title)}">
<meta property="og:description" content="${esc(t.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${s.url}assets/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(t.ogAlt)}">
<meta property="profile:first_name" content="Philipp">
<meta property="profile:last_name" content="Paulik">
<meta property="profile:username" content="${s.handle}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@philppplik">
<meta name="twitter:creator" content="@philppplik">
<meta name="twitter:title" content="${esc(t.title)}">
<meta name="twitter:description" content="${esc(t.description)}">
<meta name="twitter:image" content="${s.url}assets/og.jpg">
<meta name="twitter:image:alt" content="${esc(t.ogAlt)}">

<link rel="preload" href="${P}assets/fonts/inter-tight-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${P}assets/studio.css">
<link rel="stylesheet" href="${P}assets/studio-work.css">
${consentHead(P)}
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body id="top">
<a class="skip" href="#main">${esc(t.nav.skip)}</a>
<header class="mast">
  <a class="wordmark" href="#top" aria-label="Philipp Paulik"><span class="sigil" aria-hidden="true">pp</span>Philipp Paulik</a>
  <nav aria-label="${esc(t.nav.aria)}"><a href="#projekte">${label('Arbeiten','Work')}</a><a href="#about">${esc(t.nav.about)}</a><a href="#buecher">${label('Bücher','Books')}</a></nav>
  <div class="nav-end"><a class="switch" href="${t.nav.switchHref}" hreflang="${other}" aria-label="${esc(t.nav.switch)}">${other.toUpperCase()}</a><a class="nav-contact" href="#kontakt">${label('Kontakt','Contact')}</a></div>
</header>
<main id="main">
  <section class="cover" aria-labelledby="h1">
    <div class="cover-text">
      <p class="eyebrow"><span class="spark" aria-hidden="true">✷</span> AI Strategist <span class="slash">/</span> Creative Developer</p>
      <h1 id="h1"><span>${label('Strategie','Strategy')}.</span><span>Code.</span><em>Design.</em></h1>
      <p class="pitch">${label('Ich bin Philipp. Ich entwickle KI-Strategien und baue die Werkzeuge dazu. Von der ersten Frage bis zum Interface.','I’m Philipp. I develop AI strategies and build the tools behind them, from the first question to the finished interface.')}</p>
      <div class="hero-actions"><a class="solid" href="${inquiry}">${label('Projekt anfragen','Start a project')}</a><a class="text-link" href="#projekte">${label('Arbeiten entdecken','Explore my work')}</a></div>
    </div>
    <figure class="print"><div class="print-image"><img src="${P}assets/studio-portrait.webp" alt="${label('Philipp Paulik im gerasterten Porträtdruck','Halftone portrait of Philipp Paulik')}" width="800" height="900" fetchpriority="high"><i class="crop tl"></i><i class="crop tr"></i><i class="crop bl"></i><i class="crop br"></i><span aria-hidden="true" class="print-star">✷</span></div>
    <figcaption><span>Philipp Paulik</span><span>Bonn, DE</span><i class="barcode" aria-hidden="true"></i></figcaption></figure>
  </section>
  <div class="strip"><div>${['AI Strategy','Creative Development','Interface Design','Open Source','Editorial'].map(x=>`<span>${x}</span>`).join('')}</div></div>
  ${studioWork(lang,c,P)}
  <section id="about" class="studio-about"><div class="about-img"><img loading="lazy" src="${P}${imageVariant(s.aboutPhoto,800)}" width="800" height="800" alt="${esc(t.about.photoAlt)}"></div>
    <div><p class="overline">${esc(t.nav.about)} / Bonn</p><h2>${label('Hi, ich bin Philipp.','Hi, I’m Philipp.')}</h2><p>${label('Ich mache in Bonn meine Ausbildung zum Mediengestalter Digital und Print. Im Design frage ich, was Menschen brauchen. Beim Programmieren finde ich heraus, wie es funktioniert.','I’m training in digital and print media design in Bonn. Design makes me ask what people need. Programming lets me work out how to build it.')}</p><p>${label('Besonders spannend finde ich den Moment, in dem aus einer Idee ein Werkzeug wird. Meine Projekte zu Suchmaschinen, Coding-Agents und visuellen Interfaces entwickle ich offen auf GitHub.','I love the point where an idea becomes a tool. I build search engines, coding agents and visual interfaces out in the open on GitHub.')}</p><a class="text-link" href="${L.github}">${label('Mein GitHub-Profil','My GitHub profile')}</a></div></section>
  <section class="questions"><h2 id="h-faq">${label('Kurz gefragt.','Quick questions.')}</h2><div>${faq}</div></section>
  <section class="reach" id="kontakt"><p class="overline">${label('Projektanfragen','Project enquiries')}</p><h2>${label('Was hast du vor?','What’s on your mind?')}</h2><p>${label('Schreib mir, wo es hakt oder was du bauen möchtest.','Tell me what’s getting in the way, or what you’d like to build.')}</p><a class="solid" href="${inquiry}">${label('Projekt besprechen','Discuss a project')}</a><a class="address" href="mailto:${s.email}">${s.email}</a></section>
</main>
<footer class="base"><div><a class="wordmark" href="#top"><span class="sigil" aria-hidden="true">pp</span>Philipp Paulik</a><ul>${social}</ul></div><div><span>© ${new Date().getFullYear()} Philipp Paulik</span><div class="legal-links"><a href="${PP[lang].privacyHref}">${PP[lang].privacy}</a><a href="${label('/impressum/','/en/imprint/')}">${label('Impressum','Legal notice')}</a><button type="button" class="pp-consent-open" data-pp-consent-open>${PP[lang].settings}</button></div></div></footer>
${consentScripts(P, lang)}
</body>
</html>`;
}

fs.writeFileSync(OUT + '/index.html', page('de'));
fs.writeFileSync(OUT + '/en/index.html', page('en'));
const alt = `<xhtml:link rel="alternate" hreflang="de" href="${URLS.de}"/><xhtml:link rel="alternate" hreflang="en" href="${URLS.en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${URLS.de}"/>`;
const imageEntry = (image, title) => `<image:image><image:loc>${s.url}${image}</image:loc><image:title>${esc(title)}</image:title><image:caption>${esc(title)}</image:caption></image:image>`;
const images = (t) => imageEntry(s.photo, t.hero.photoAlt) + imageEntry(s.aboutPhoto, t.about.photoAlt) + imageEntry('assets/og.jpg', t.ogAlt);
fs.writeFileSync(OUT + '/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n  <url><loc>${URLS.de}</loc><lastmod>${today}</lastmod><priority>1.0</priority>${alt}${images(c.i18n.de)}</url>\n  <url><loc>${URLS.en}</loc><lastmod>${today}</lastmod><priority>0.9</priority>${alt}${images(c.i18n.en)}</url>\n  <url><loc>${s.url}impressum/</loc><lastmod>${today}</lastmod><priority>0.3</priority></url>
  <url><loc>${s.url}datenschutz/</loc><lastmod>${today}</lastmod><priority>0.3</priority></url>
  <url><loc>${s.url}en/imprint/</loc><lastmod>${today}</lastmod><priority>0.3</priority></url>
  <url><loc>${s.url}en/privacy/</loc><lastmod>${today}</lastmod><priority>0.3</priority></url>\n</urlset>\n`);
fs.writeFileSync(OUT + '/robots.txt', `User-agent: *\nAllow: /\n\n# AI crawlers explicitly welcome (GEO/AEO)\nUser-agent: GPTBot\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\nUser-agent: Google-Extended\nAllow: /\n\nSitemap: ${s.url}sitemap.xml\n`);
const en = c.i18n.en;
const de = c.i18n.de;
const projLine = (p, l) => `- [${p.name}](${p.url}): ${p[l].type}. ${p[l].desc}`;
fs.writeFileSync(OUT + '/llms.txt', `# ${s.name}

> ${s.name} (online: ${s.handle}) is an AI pioneer and strategist, web and UI/UX designer, software engineer by passion and author from Bonn, Germany. He builds his own AI tools and agents (true-code, ZWEP, Flower). This site is his official portfolio and the canonical source for facts about him. German and English versions.

## Key pages
- [Portfolio (Deutsch)](${URLS.de}): main page with projects, about, FAQ and contact
- [Portfolio (English)](${URLS.en}): same content in English
- [Full text for LLMs](${s.url}llms-full.txt): complete content of this site as plain text

## Photos\n- [Portrait on a sofa](${s.url}${s.photo}): ${c.i18n.en.hero.photoAlt}\n- [Portrait at a desk](${s.url}${s.aboutPhoto}): ${c.i18n.en.about.photoAlt}\n\n## Profiles (verified, same person)
- [GitHub](${L.github}): code and open source
- [X](${L.x})
- [Instagram](${L.instagram})
- [YouTube](${L.youtube})
- [LinkedIn](${L.linkedin})
- [npm](${L.npm}): published packages
- [Wikidata](${L.wikidata})
- [Daily Hob](${L.hob}): AI briefing archive

## Projects
${c.projects.map((p) => projLine(p, 'en')).join('\n')}

## Optional
${c.more.map((m) => `- [${m.name}](${m.url}): ${m.en}`).join('\n')}
`);
const full = (l, t) => `## ${l === 'de' ? 'Deutsch' : 'English'}\n\n${t.description}\n\n### ${t.about.kicker}\n${t.about.paras.join('\n\n')}\n\n${t.about.facts.map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n### ${t.work.kicker}\n${c.projects.map((p) => `#### ${p.name} (${p[l].type})\n${p[l].desc}\nStack: ${p.stack}\nLink: ${p.url}${p.npm ? '\nnpm: ' + p.npm : ''}${p.repo ? '\nRepo: ' + p.repo : ''}`).join('\n\n')}\n\n### ${t.skills.kicker}\n${t.skills.items.map((d) => `- ${d.title}: ${d.text} (${d.tags.join(', ')})`).join('\n')}\n\n### ${t.faqTitle}\n${t.faq.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n')}\n`;
fs.writeFileSync(OUT + '/llms-full.txt', `# ${s.name} - full site content\n\nSource: ${s.url}\nContact: ${s.email}\n\n${full('de', de)}\n${full('en', en)}`);
function subPage(lang, title, route, body, alternate) {
  const en = lang === 'en', home = en ? '/en/' : '/';
  const sections = [];
  const article = body.replace(/<h2>([^<]+)<\/h2>/g, (_, heading) => {
    const id = 'section-' + (sections.length + 1);
    sections.push({id,heading});
    return `<h2 id="${id}">${heading}</h2>`;
  });
  const toc = sections.length ? `<nav class="sub-index" aria-label="${en ? 'On this page' : 'Auf dieser Seite'}"><p class="overline">${en ? 'On this page' : 'Auf dieser Seite'}</p>${sections.map(x => `<a href="#${x.id}">${x.heading}</a>`).join('')}</nav>` : '';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Philipp Paulik</title><meta name="theme-color" content="#f7f6f1">${route ? `<link rel="canonical" href="${s.url}${route}">` : '<meta name="robots" content="noindex">'}<link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/assets/studio.css">${consentHead('/')}</head>
<body><a class="skip" href="#main">${en?'Skip to content':'Zum Inhalt springen'}</a><header class="mast sub-mast"><a class="wordmark" href="${home}"><span class="sigil" aria-hidden="true">pp</span>Philipp Paulik</a><div class="nav-end">${alternate ? `<a class="switch" href="${alternate}" hreflang="${en?'de':'en'}">${en?'DE':'EN'}</a>` : ''}<a class="nav-contact" href="${home}">Portfolio</a></div></header>
<main class="subpage" id="main"><p class="overline">${route ? (en?'Portfolio / Legal':'Portfolio / Rechtliches') : '404'}</p><h1>${esc(title)}<em>.</em></h1><div class="sub-layout">${toc}<article>${article}</article></div></main>
<footer class="base"><div><span>© ${new Date().getFullYear()} Philipp Paulik</span><div class="legal-links"><a href="${home}">Portfolio</a><a href="${en?'/en/imprint/':'/impressum/'}">${en?'Legal notice':'Impressum'}</a><a href="${PP[lang].privacyHref}">${PP[lang].privacy}</a><button class="pp-consent-open" type="button" data-pp-consent-open>${PP[lang].settings}</button></div></div></footer>${consentScripts('/',lang)}</body></html>`;
}

fs.writeFileSync(OUT + '/404.html', subPage('de','Seite nicht gefunden','', '<p>Unter dieser Adresse gibt es keine Seite. Im Portfolio findest du meine Arbeiten und Bücher.</p><a class="solid" href="/">Zum Portfolio</a>', ''));
fs.mkdirSync(OUT + '/impressum', { recursive: true });
fs.mkdirSync(OUT + '/en/imprint', { recursive: true });
fs.writeFileSync(OUT + '/impressum/index.html', subPage('de','Impressum','impressum/',`<p class="mut">Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)</p><h2>Anbieter</h2><p>${esc(s.name)}<br>Mozartstraße 1<br>53819 Neunkirchen-Seelscheid<br>Deutschland</p><h2>Kontakt</h2><p>E-Mail: <a href="mailto:${s.email}">${s.email}</a></p><h2>Urheberrecht</h2><p>Die vom Betreiber dieser Seite erstellten Inhalte und Werke unterliegen dem deutschen Urheberrecht. Beiträge Dritter sind als solche gekennzeichnet.</p>`, '/en/imprint/'));
fs.writeFileSync(OUT + '/en/imprint/index.html', subPage('en','Legal notice','en/imprint/',`<p>Information pursuant to section 5 of the German Digital Services Act (DDG).</p><h2>Provider</h2><p>${esc(s.name)}<br>Mozartstraße 1<br>53819 Neunkirchen-Seelscheid<br>Germany</p><h2>Contact</h2><p>Email: <a href="mailto:${s.email}">${s.email}</a></p><h2>Copyright</h2><p>Works created by the operator of this website are subject to German copyright law. Third-party contributions are identified as such.</p>`, '/impressum/'));
const dsBody = `<h2>Verantwortlicher</h2><p>Philipp Paulik (Kontakt wie im <a href="/impressum/">Impressum</a>).</p><h2>Statistik mit Einwilligung</h2><p>Die Portfolio-Hauptseite lädt ohne deine Einwilligung keinen Analysecode. Mit deiner Einwilligung &bdquo;Statistik&ldquo; nutzen wir Google Analytics 4 (Google Ireland Limited), um zu verstehen, welche Seiten und Projekte besucht werden. Gemessen werden Seitenaufrufe, Lesetiefe, Klicks auf festgelegte externe Links (nur die Ziel-Domain), die Herkunft als Domain sowie vorher festgelegte Kampagnenkennungen. Nicht erfasst werden: Eingaben, vollständige Adressen, Werbeprofile, seitenübergreifende Wiedererkennung. Standort nur als Land, Gerät nur als Kategorie; Speicherung der Ereignisse 14 Monate. Die Statistik-Cookies gelten nur für philipp-paulik.de, nicht für Unterprojekte wie hob.philipp-paulik.de.</p><h2>Widerruf</h2><p>Widerruf jederzeit über die Datenschutzeinstellungen im Fußbereich; die Cookies werden gelöscht und die Messung stoppt.</p><h2>Rechtsgrundlage und Empfänger</h2><p>Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG. Empfänger: Google; mögliche Übermittlung in die USA (EU-US Data Privacy Framework). Details: <a href="https://policies.google.com/privacy" rel="noopener noreferrer">policies.google.com/privacy</a></p><h2>Cookies und lokale Speicherung</h2><p>pp_consent_v1 (Cookie, 180 Tage) und pp-consent-v1 (lokaler Speicher): deine Datenschutzauswahl. _ga und _ga_&lt;ID&gt; (nur philipp-paulik.de, bis 180 Tage, nur nach Einwilligung): Statistik.</p><h2>Technische Dienste auf unseren Subdomains</h2><p>Die Verwaltungs-, Datei-, Blog-, Landingpage-, Anzeigen-, Kurzlink- und Statistikdienste unter analytics., static., l., blog., lp., ads. und m.philipp-paulik.de werden über Netlify bereitgestellt. Inhalte, hochgeladene Dateien, Kurzlinkziele sowie technische Sitzungs- und Zähldaten werden in einer PostgreSQL-Datenbank bei Neon gespeichert. Bei Aufrufen verarbeiten die Hostinganbieter technisch notwendige Verbindungsdaten, insbesondere IP-Adresse, angeforderte Adresse, Zeitpunkt und Browserinformationen, um die Dienste auszuliefern, zu sichern und Fehler zu erkennen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (sicherer Betrieb). Die Anbieter können Daten auch in den USA verarbeiten. Weitere Informationen: <a href="https://www.netlify.com/privacy/" rel="noopener noreferrer">Netlify</a> und <a href="https://neon.com/privacy-policy" rel="noopener noreferrer">Neon</a>.</p><h2>Geschützter Verwaltungszugang</h2><p>Die Anmeldung verwendet E-Mail-Adresse und Passwort. Serverseitig ist eine gesalzene Passwortableitung hinterlegt, nicht das Anmeldepasswort im Klartext. Der technisch notwendige Cookie __Host-console dient ausschließlich der Anmeldung am jeweiligen Dienst und läuft nach einer Stunde ab. Er ist keine Werbe- oder Analysekennung. Rechtsgrundlagen sind § 25 Abs. 2 Nr. 2 TDDDG für den notwendigen Zugriff auf das Endgerät und Art. 6 Abs. 1 lit. f DSGVO für den sicheren Verwaltungszugang. Abgelaufene Sitzungsdaten werden bei weiterer Nutzung bereinigt.</p><h2>Dateien, Inhalte und Kurzlinks</h2><p>Hochgeladene Dateien sind zunächst privat. Nach Freigabe sind sie über ihren Link abrufbar, auch wenn der Link weitergegeben wird. Inhalte und Dateien bleiben bis zu ihrer Änderung oder Löschung gespeichert. Für Kurzlinks zählt die Anwendung Weiterleitungsanfragen je Link und UTC-Tag. Dafür speichert sie keine IP-Adressen oder eindeutigen Besucherkennungen in der Zählertabelle. Diese technischen Zähler dienen der Funktionskontrolle bereitgestellter Links (Art. 6 Abs. 1 lit. f DSGVO), nicht der Wiedererkennung einzelner Personen. Ältere Tageszähler werden bei Nutzung bereinigt; der vorgesehene Zeitraum beträgt 90 Tage. Diese Anwendungsfristen sind keine Löschgarantie für technische Protokolle oder Sicherungskopien der Hostinganbieter. Dort gelten eigene Speicher- und Löschverfahren.</p><h2>Geschützte Statistikansicht</h2><p>Bereits erhobene GA4-Auswertungen werden für den geschützten Statistikbereich zusätzlich serverseitig bei Netlify entschlüsselt und nach Anmeldung angezeigt. Die Verarbeitung kann dabei in den USA erfolgen. Dies ist keine zusätzliche GA4-Messung ohne Einwilligung.</p><h2>Newsletter in Vorbereitung</h2><p>Ein Newsletter wird vorbereitet. Derzeit sind Anmeldung, Bestätigungs- und Newsletterversand nicht freigeschaltet. Für den späteren Versand wird die Absenderdomain beim Dienst Resend vorbereitet; aktuell werden darüber keine Newsletter-Abonnentendaten übertragen. Vor Aktivierung ergänzen wir die Hinweise zu E-Mail-Adresse, Einwilligung, Double-Opt-in, Abmeldung und Versanddienst. Ein Websitebesuch ist keine Newsletter-Anmeldung.</p>`;
const pvBody = `<h2>Controller</h2><p>Philipp Paulik (contact see <a href="/en/imprint/">legal notice</a>).</p><h2>Analytics with consent</h2><p>Without your consent the main portfolio site loads no analytics code. With your &ldquo;Statistics&rdquo; consent we use Google Analytics 4 (Google Ireland Limited) to see which pages and projects are visited. Measured: page views, reading depth, clicks on allowlisted external links (target domain only), origin as domain, and pre-defined campaign identifiers. Not collected: any input, full URLs, advertising profiles, cross-site recognition. Location limited to country, device to category; events are kept for 14 months. Analytics cookies apply to philipp-paulik.de only, not to sub-projects such as hob.philipp-paulik.de.</p><h2>Withdrawal</h2><p>Withdraw anytime via the privacy settings in the footer; cookies are deleted and measurement stops.</p><h2>Legal basis and recipient</h2><p>Legal basis: Art. 6(1)(a) GDPR, § 25(1) TDDDG. Recipient: Google; transfer to the USA possible (EU-US Data Privacy Framework). Details: <a href="https://policies.google.com/privacy" rel="noopener noreferrer">policies.google.com/privacy</a></p><h2>Cookies and local storage</h2><p>pp_consent_v1 (cookie, 180 days) and pp-consent-v1 (local storage): your privacy choice. _ga and _ga_&lt;ID&gt; (philipp-paulik.de only, up to 180 days, only after consent): analytics.</p><h2>Technical services on our subdomains</h2><p>The administration, file, blog, landing page, advertisement, short link and statistics services at analytics., static., l., blog., lp., ads. and m.philipp-paulik.de are hosted by Netlify. Content, uploaded files, short link destinations, technical session data and counters are stored in a PostgreSQL database at Neon. Hosting providers process connection data needed to deliver and secure these services and diagnose errors, including IP addresses, requested addresses, timestamps and browser information. The legal basis is Art. 6(1)(f) GDPR (secure operation). Providers may also process data in the USA. More information: <a href="https://www.netlify.com/privacy/" rel="noopener noreferrer">Netlify</a> and <a href="https://neon.com/privacy-policy" rel="noopener noreferrer">Neon</a>.</p><h2>Protected administration access</h2><p>Sign-in uses an email address and password. The server holds a salted password derivation, not the sign-in password in plain text. The strictly necessary __Host-console cookie is used only for sign-in to the individual service and expires after one hour. It is not an advertising or analytics identifier. The legal bases are § 25(2) no. 2 TDDDG for necessary device access and Art. 6(1)(f) GDPR for secure administration access. Expired session records are cleaned up during subsequent use.</p><h2>Files, content and short links</h2><p>Uploaded files are private initially. Once shared, they can be accessed through their link, including when that link is passed on. Content and files remain stored until changed or deleted. The application counts short link forwarding requests by link and UTC day. The counter table stores no IP addresses or unique visitor identifiers for this purpose. These technical counters help check that the links work (Art. 6(1)(f) GDPR); they do not recognise individual people. Older daily counters are cleaned up during use, with an intended retention period of 90 days. These application periods do not guarantee deletion from providers' technical logs or backups, which follow their own storage and deletion procedures.</p><h2>Protected statistics view</h2><p>Existing GA4 reports are also decrypted server-side at Netlify for the protected statistics area and displayed after sign-in. This processing may take place in the USA. It does not introduce additional GA4 measurement without consent.</p><h2>Newsletter in preparation</h2><p>A newsletter is being prepared. Sign-up, confirmation messages and newsletter delivery are currently disabled. The sender domain is being prepared at Resend for future delivery; no newsletter subscriber data is currently transferred through it. Before activation, we will add information about email addresses, consent, double opt-in, unsubscribing and the delivery provider. Visiting this site does not subscribe you to a newsletter.</p>`;
fs.mkdirSync(OUT + '/datenschutz', { recursive: true });
fs.writeFileSync(OUT + '/datenschutz/index.html', subPage('de','Datenschutz','datenschutz/',dsBody,'/en/privacy/'));
fs.mkdirSync(OUT + '/en/privacy', { recursive: true });
fs.writeFileSync(OUT + '/en/privacy/index.html', subPage('en','Privacy policy','en/privacy/',pvBody,'/datenschutz/'));
console.log('built');
