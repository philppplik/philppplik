// Build: node site/src/build.mjs <outdir>  -> DE at /, EN at /en/, plus sitemap, robots, llms.txt, 404
import fs from 'node:fs';
const OUT = process.argv[2] || 'out';
const c = JSON.parse(fs.readFileSync(new URL('./content.json', import.meta.url), 'utf8'));
const s = c.site, L = s.links;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const today = new Date().toISOString().slice(0, 10);
const words = (t) => t.split(' ').map((w) => `<span class="w">${esc(w)}</span>`).join(' ');
const URLS = { de: s.url, en: s.url + 'en/' };
const sameAs = [L.github, L.x, L.instagram, L.youtube, L.linkedin, L.npm, L.spotify, L.book];
fs.mkdirSync(OUT + '/en', { recursive: true });
fs.mkdirSync(OUT + '/assets', { recursive: true });

function page(lang) {
  const t = c.i18n[lang], P = lang === 'de' ? '' : '../', url = URLS[lang], other = lang === 'de' ? 'en' : 'de';
  const proj = (p) => ({ ...p, ...p[lang] });
  const projects = c.projects.map(proj);

  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': s.url + '#website', url: s.url, name: s.name + ' Portfolio', inLanguage: ['de-DE', 'en'], publisher: { '@id': s.url + '#person' } },
      { '@type': 'ProfilePage', '@id': url + '#webpage', url, name: t.title, description: t.description, inLanguage: lang === 'de' ? 'de-DE' : 'en', isPartOf: { '@id': s.url + '#website' }, about: { '@id': s.url + '#person' }, mainEntity: { '@id': s.url + '#person' }, primaryImageOfPage: { '@id': s.url + '#photo' }, dateModified: today, breadcrumb: { '@id': url + '#crumbs' } },
      { '@type': 'ImageObject', '@id': s.url + '#photo', url: s.url + s.photo, contentUrl: s.url + s.photo, width: 900, height: 900, caption: t.about.photoAlt, creditText: s.name },
      { '@type': 'Person', '@id': s.url + '#person', name: s.name, alternateName: s.handle, url: s.url, image: { '@id': s.url + '#photo' }, email: undefined, jobTitle: lang === 'de' ? 'KI-Pionier und KI-Stratege, Webdesigner, UI/UX-Designer, Software Engineer, Autor' : 'AI Pioneer and Strategist, Web Designer, UI/UX Designer, Software Engineer, Author', description: t.description, homeLocation: { '@type': 'Place', name: 'Bonn, Germany' }, address: { '@type': 'PostalAddress', addressLocality: 'Bonn', addressCountry: 'DE' }, knowsLanguage: ['de', 'en'], knowsAbout: ['AI Strategy', 'Artificial Intelligence', 'AI Agents', 'Model Context Protocol', 'Web Design', 'UI/UX Design', 'Software Engineering', 'TypeScript', 'Rust', 'Authoring'], sameAs, subjectOf: { '@id': s.url + '#projects' } },
      { '@type': 'ItemList', '@id': s.url + '#projects', name: lang === 'de' ? 'Projekte von Philipp Paulik' : 'Projects by Philipp Paulik', itemListElement: projects.map((p, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'SoftwareSourceCode', name: p.name, description: p.desc, codeRepositoryUrl: p.repo || p.url, url: p.url, programmingLanguage: p.lang, author: { '@id': s.url + '#person' } } })) },
      { '@type': 'Book', name: t.writing.bookName, inLanguage: 'de', url: L.book, author: { '@id': s.url + '#person' } },
      { '@type': 'MusicAlbum', name: 'Living in a Lego World', url: L.spotify, byArtist: { '@id': s.url + '#person' } },
      { '@type': 'FAQPage', '@id': url + '#faq', mainEntity: t.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
      { '@type': 'BreadcrumbList', '@id': url + '#crumbs', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Portfolio', item: url }] }
    ]
  };

  const arrow = '<span aria-hidden="true">↗</span>';
  const cards = projects.map((p, i) => `
        <article class="card${p.featured ? ' feat' : ''}" style="--c:${p.color}" aria-labelledby="p${i}">
          <div class="card-top"><span class="mono">${String(i + 1).padStart(2, '0')} / ${String(projects.length).padStart(2, '0')}</span>${p.featured ? `<span class="mono badge">★ ${esc(t.work.featured)}</span>` : `<span class="mono">${esc(p.year)}</span>`}</div>
          <div class="card-art" aria-hidden="true"><span>${esc(p.name.charAt(0))}</span></div>
          <div class="card-body">
            <p class="mono tag">${esc(p.type)}</p>
            <h3 id="p${i}">${esc(p.name)}</h3>
            <p>${esc(p.desc)}</p>
            <p class="mono stack">${esc(p.stack)}</p>
            <p class="links"><a href="${esc(p.url)}" rel="noopener" data-cursor="${esc(t.work.open)}">${p.live ? t.work.live : t.work.github} ${arrow}</a>${p.npm ? ` <a href="${esc(p.npm)}" rel="noopener">npm ${arrow}</a>` : ''}${p.repo ? ` <a href="${esc(p.repo)}" rel="noopener">Repo ${arrow}</a>` : ''}</p>
          </div>
        </article>`).join('');
  const more = c.more.map((m) => `<li class="reveal"><a href="${esc(m.url)}" rel="noopener"><strong>${esc(m.name)}</strong><span>${esc(m[lang])}</span><i aria-hidden="true">↗</i></a></li>`).join('');
  const disc = t.skills.items.map((d) => `
        <article class="disc reveal">
          <span class="mono">${d.n}</span>
          <h3>${esc(d.title)}</h3>
          <p>${esc(d.text)}</p>
          <ul class="chips" aria-label="${esc(d.title)} ${esc(t.skills.toolsLabel)}">${d.tags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        </article>`).join('');
  const faq = t.faq.map((f) => `<details class="reveal"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  const tickerHtml = [...t.ticker, ...t.ticker].map((x) => `<span>${esc(x)}</span>`).join('<b aria-hidden="true">✺</b>');
  const facts = t.about.facts.map(([k, v]) => `<div><dt class="mono">${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  const social = [['GitHub', L.github], ['X', L.x], ['Instagram', L.instagram], ['YouTube', L.youtube], ['LinkedIn', L.linkedin], ['npm', L.npm], ['Spotify', L.spotify], ['paulik-reisch.de', L.book]].map(([n, h]) => `<li><a href="${esc(h)}" rel="me noopener">${esc(n)}</a></li>`).join('');

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(t.title)}</title>
<meta name="description" content="${esc(t.description)}">
<meta name="author" content="${esc(s.name)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="theme-color" content="#0b0b0c">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="de" href="${URLS.de}">
<link rel="alternate" hreflang="en" href="${URLS.en}">
<link rel="alternate" hreflang="x-default" href="${URLS.de}">
<link rel="alternate" type="text/plain" href="${s.url}llms.txt" title="LLM-readable summary">
<link rel="icon" href="${P}assets/favicon.svg" type="image/svg+xml">
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
<link rel="preload" href="${P}assets/fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${P}assets/fonts/inter-tight-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${P}assets/style.css">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body>
<a class="skip" href="#main">${esc(t.nav.skip)}</a>
<div class="progress" aria-hidden="true"><i></i></div>
<div class="cursor" aria-hidden="true"><span></span></div>
<header class="top">
  <a class="brand" href="#top" aria-label="${esc(s.name)} - ${esc(t.nav.top)}">PP<span aria-hidden="true">®</span></a>
  <nav aria-label="${esc(t.nav.aria)}"><a href="#projekte">${esc(t.nav.work)}</a><a href="#about">${esc(t.nav.about)}</a><a href="#hallo-welt">${esc(t.nav.books)}</a><a href="#kontakt">${esc(t.nav.contact)}</a><a class="lang" href="${t.nav.switchHref}" hreflang="${t.nav.switchLang}" lang="${t.nav.switchLang}">${esc(t.nav.switch)}</a></nav>
</header>
<main id="main">
  <section class="hero" id="top" aria-labelledby="h1">
    <div class="glow" aria-hidden="true"></div>
    <figure class="hero-photo"><img src="${P}${s.photo}" alt="${esc(t.hero.photoAlt)}" width="900" height="900" fetchpriority="high"></figure>
    <p class="mono kicker">${esc(t.location)} · ${esc(t.hero.kicker)}</p>
    <h1 id="h1"><span class="sr">${esc(t.hero.srPrefix)}</span>${t.hero.lines.map((l, i) => `<span class="line"><span class="line-in${i === 1 ? ' it' : ''}">${esc(l)}</span></span>`).join('')}</h1>
    <div class="hero-foot">
      <p class="lead">${esc(t.hero.sub)}</p>
      <p class="mono who"><strong>${esc(s.name)}</strong><br>${esc(t.role)}</p>
      <a class="scroll mono" href="#manifest">${esc(t.hero.scroll)} <span aria-hidden="true">↓</span></a>
    </div>
  </section>
  <div class="ticker" aria-hidden="true"><div class="ticker-in">${tickerHtml}</div></div>

  <section class="manifest" id="manifest" aria-label="${esc(t.manifestoLabel)}">
    <p class="mono kicker">${esc(t.manifestoLabel)}</p>
    <p class="big" id="manifest-text">${words(t.manifesto)}</p>
  </section>

  <section class="work" id="projekte" aria-labelledby="h-work">
    <div class="work-pin">
      <div class="work-head">
        <p class="mono kicker">${esc(t.work.kicker)}</p>
        <h2 id="h-work">${t.work.title}</h2>
        <p class="mono hint">${esc(t.work.hint)}</p>
      </div>
      <div class="track">${cards}
      </div>
    </div>
  </section>

  <section class="more" aria-labelledby="h-more">
    <h2 id="h-more" class="mono kicker">${esc(t.more.title)}</h2>
    <ul>${more}</ul>
  </section>

  <section class="about" id="about" aria-labelledby="h-about">
    <figure class="about-photo reveal"><img src="${P}${s.photo}" alt="${esc(t.about.photoAlt)}" width="900" height="900" loading="lazy"></figure>
    <div class="about-text">
      <p class="mono kicker reveal">${esc(t.about.kicker)}</p>
      <h2 id="h-about" class="reveal">${t.about.title}</h2>
      ${t.about.paras.map((x) => `<p class="reveal body">${esc(x)}</p>`).join('\n      ')}
      <dl class="facts reveal">${facts}</dl>
    </div>
  </section>

  <section class="skills" id="skills" aria-labelledby="h-skills">
    <p class="mono kicker reveal">${esc(t.skills.kicker)}</p>
    <h2 id="h-skills" class="reveal">${t.skills.title}</h2>
    <div class="disc-grid">${disc}
    </div>
  </section>

  <section class="writing" id="hallo-welt" aria-labelledby="h-writing">
    <p class="mono kicker reveal">${esc(t.writing.kicker)}</p>
    <h2 id="h-writing" class="reveal">${esc(t.writing.title)}<span class="sub">${esc(t.writing.subtitle)}</span></h2>
    <p class="reveal body">${esc(t.writing.text)}</p>
    <a class="btn reveal" href="${esc(L.book)}" rel="noopener" data-cursor="${esc(t.work.open)}">${esc(t.writing.cta)} ${arrow}</a>
    <div class="music reveal">
      <p class="mono kicker">${esc(t.music.kicker)}</p>
      <h3>${esc(t.music.title)}</h3>
      <div><p>${esc(t.music.text)}</p><p><a class="btn sm" href="${esc(L.spotify)}" rel="noopener">${esc(t.music.cta)} ${arrow}</a></p></div>
    </div>
  </section>

  <section class="faq" aria-labelledby="h-faq">
    <h2 id="h-faq" class="mono kicker">${esc(t.faqTitle)}</h2>
    ${faq}
  </section>

  <section class="contact" id="kontakt" aria-labelledby="h-contact">
    <p class="mono kicker reveal">${esc(t.contact.kicker)}</p>
    <h2 id="h-contact"><a href="mailto:${s.email}" data-cursor="${esc(t.contact.cursor)}"><span class="line"><span class="line-in">${esc(t.contact.l1)}</span></span><span class="line"><span class="line-in it">${esc(t.contact.l2)}</span></span></a></h2>
    <p class="mono mail"><a href="mailto:${s.email}">${s.email}</a></p>
    <ul class="social mono">${social}</ul>
  </section>
</main>
<footer class="foot mono"><span>© ${new Date().getFullYear()} ${esc(s.name)}</span><span>${esc(t.foot.made)}</span><a href="#top">${esc(t.foot.up)}</a></footer>
<script src="${P}assets/vendor/gsap.min.js"></script>
<script src="${P}assets/vendor/ScrollTrigger.min.js"></script>
<script src="${P}assets/vendor/lenis.min.js"></script>
<script src="${P}assets/main.js"></script>
</body>
</html>`;
}

fs.writeFileSync(OUT + '/index.html', page('de'));
fs.writeFileSync(OUT + '/en/index.html', page('en'));
const alt = `<xhtml:link rel="alternate" hreflang="de" href="${URLS.de}"/><xhtml:link rel="alternate" hreflang="en" href="${URLS.en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${URLS.de}"/>`;
fs.writeFileSync(OUT + '/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n  <url><loc>${URLS.de}</loc><lastmod>${today}</lastmod><priority>1.0</priority>${alt}</url>\n  <url><loc>${URLS.en}</loc><lastmod>${today}</lastmod><priority>0.9</priority>${alt}</url>\n</urlset>\n`);
fs.writeFileSync(OUT + '/robots.txt', `User-agent: *\nAllow: /\n\n# AI crawlers explicitly welcome (GEO/AEO)\nUser-agent: GPTBot\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\nUser-agent: Google-Extended\nAllow: /\n\nSitemap: ${s.url}sitemap.xml\n`);
const en = c.i18n.en;
fs.writeFileSync(OUT + '/llms.txt', `# ${s.name} (${s.handle})\n\n> ${en.description}\n\n## Profile\n- Roles: AI Pioneer and Strategist, Web Designer, UI/UX Designer, Software Engineer, Author\n- Location: Bonn, Germany\n- Languages: German, English\n- Portfolio (DE): ${URLS.de}\n- Portfolio (EN): ${URLS.en}\n- GitHub: ${L.github}\n- X: ${L.x}\n- Instagram: ${L.instagram}\n- YouTube: ${L.youtube}\n- LinkedIn: ${L.linkedin}\n- npm: ${L.npm}\n\n## Projects\n${c.projects.map((p) => `- [${p.name}](${p.url}): ${p.en.type}. ${p.en.desc}`).join('\n')}\n\n## Writing\n- [Hallo Welt](${L.book}): ${en.writing.text}\n\n## FAQ\n${en.faq.map((f) => `Q: ${f.q}\nA: ${f.a}\n`).join('\n')}`);
fs.writeFileSync(OUT + '/404.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>404 - ${esc(s.name)}</title><link rel="stylesheet" href="${s.url}assets/style.css"></head><body><main class="nf"><p class="mono kicker">404</p><h1><span class="it">Nothing</span> here.</h1><p><a class="btn" href="${s.url}">Portfolio →</a></p></main></body></html>`);
fs.writeFileSync(OUT + '/assets/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b0b0c"/><text x="32" y="44" font-family="Georgia,serif" font-style="italic" font-size="34" text-anchor="middle" fill="#ff5b2e">pp</text></svg>`);
console.log('built');
