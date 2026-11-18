const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// The flower poster uses the same basic idea as the project: a sampled shape rendered as text.
function flowerPrint() {
  const lines = [];
  for (let row = 0; row < 29; row++) {
    let line = '';
    for (let column = 0; column < 65; column++) {
      const x = (column - 32) / 28;
      const y = (row - 14) / 13;
      const r = Math.hypot(x, y);
      const angle = Math.atan2(y, x);
      const edge = 0.68 + 0.25 * Math.cos(7 * angle + r * 1.4);
      const shade = (Math.sin(36 * r - 3 * angle) + 1) / 2;
      const ink = r < 0.18 ? '@' : '.:+*#%'[Math.floor(shade * 5)];
      line += r < edge ? ink : ' ';
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

const artwork = [
  '<div class="sw-art sw-terminal"><div class="sw-terminal-grid"></div><b>t<span>_</span></b><small>RUST / RATATUI</small></div>',
  '<div class="sw-art sw-search"><div class="sw-index">' + '<i></i>'.repeat(13) + '</div><b>ZWEP</b></div>',
  '<div class="sw-art sw-flower"><pre>' + flowerPrint() + '</pre><small>ASCII / CANVAS</small></div>'
];

function projectLinks(p, lang) {
  const primary = p.live ? (lang === 'de' ? 'Live ansehen' : 'View live') : 'GitHub';
  return [[primary, p.url], ['GitHub', p.repo], ['npm', p.npm]]
    .filter(([, url]) => url)
    .map(([label, url]) => `<a href="${esc(url)}" aria-label="${esc(p.name + ' · ' + label)}">${label}</a>`).join('');
}

export function studioWork(lang, c, P) {
  const de = lang === 'de';
  const pick = (german, english) => de ? german : english;
  const t = c.i18n[lang].sites;
  const projects = c.projects;
  const archive = projects.filter(p => !p.featured);
  const cards = projects.filter(p => p.featured).map((p, i) => `
    <article class="sw-card">
      <a class="sw-cover" href="${esc(p.url)}" aria-label="${esc(p.name)}"><div aria-hidden="true">${artwork[i]}</div></a>
      <div class="sw-card-meta">${esc(p[lang].type)}</div>
      <h3>${esc(p.name)}</h3><p>${esc(p[lang].desc)}</p>
      <div class="sw-links">${projectLinks(p, lang)}</div>
    </article>`).join('');
  const rows = archive.map(p => `<li><div><strong>${esc(p.name)}</strong><p>${esc(p[lang].type)}</p></div><div class="sw-links">${projectLinks(p,lang)}</div></li>`).join('');
  const extra = c.more.map(p => `<li><div><strong>${esc(p.name)}</strong><p>${esc(p[lang])}</p></div><div class="sw-links"><a href="${esc(p.url)}" aria-label="${esc(p.name)} · GitHub">GitHub</a></div></li>`).join('');
  return `
  <section class="sw-shell" id="projekte" aria-labelledby="sw-heading">
    <div class="sw-inner">
      <div class="sw-sectionhead"><h2 id="sw-heading">${pick('Ausgewählte Arbeiten','Selected work')}<em>.</em></h2><span class="sw-mono">Open Source / 2026</span></div>
      <div class="sw-cards">${cards}</div>
      <details class="sw-archive"><summary>${pick('Weitere Projekte','More projects')} <span>(${archive.length+c.more.length})</span></summary><ul>${rows}${extra}</ul></details>
      <div class="sw-current"><div><span class="sw-mono">${pick('In Entwicklung','In development')}</span><h3>open-fini</h3></div><div><p>${pick('Vier Studios für Vektor, Pixel, Layout und Code in einer schlanken Open-Source-Suite.','Four studios for vector, pixel, layout and code in one lightweight open-source creative suite.')}</p><div class="sw-links"><a href="https://github.com/philppplik/open-fini">${pick('Entwicklung auf GitHub','Development on GitHub')}</a></div></div></div>
    </div>
  </section>
  <section class="sw-publishing" id="buecher" aria-labelledby="sw-book">
    <div class="sw-inner">
      <div class="sw-sectionhead"><h2 id="sw-book">${pick('Veröffentlichungen','Publications')}<em>.</em></h2></div>
      <article class="sw-book"><img loading="lazy" decoding="async" width="1152" height="494" src="${P}assets/studio-book.webp" alt="${pick('Hallo Welt von Philipp Paulik und Maximilian Reisch auf liniertem Papier','Hallo Welt by Philipp Paulik and Maximilian Reisch on ruled paper')}"><div><span class="sw-mono">${pick('Buch / Satire','Book / Satire')}</span><h3>Hallo Welt</h3><p>${pick('Mit Maximilian Reisch habe ich ein Buch über den Schulalltag geschrieben. In 36 Kapiteln nehmen wir uns Vertretungsstunden, Amtsdeutsch und den Wahnsinn dazwischen vor.','Together with Maximilian Reisch, I wrote a satire about life at school. Across 36 chapters we take on substitute lessons, bureaucratic language and everything that happens in between.')}</p><div class="sw-links"><a href="https://paulikreisch.de/leseprobe">${pick('Leseprobe lesen','Read a sample (DE)')}</a><a href="https://paulikreisch.de/shop">${pick('Zum Buch','Bookshop (DE)')}</a></div></div></article>
      <article class="sw-book sw-nature"><figure><img loading="lazy" decoding="async" width="324" height="500" src="${P}assets/studio-invasive.webp" alt="${pick('Originalcover von Untersuchung invasiver Arten','Cover of Untersuchung invasiver Arten')}"></figure><div><span class="sw-mono">${pick('Sachbuch / Biologie','Nonfiction / Biology')}</span><h3>Untersuchung invasiver Arten</h3><p>Ein prekäres Übel im modernen Ökosystem?</p><p class="sw-byline">Philipp Paulik · ${pick('230 Seiten','230 pages')}<br>ISBN 9798335362467</p><div class="sw-links"><a href="https://www.foyles.co.uk/book/untersuchung-invasiver-arten/philipp-paulik/9798335362467">${pick('Buch bei Foyles ansehen','View book at Foyles')}</a></div></div></article>
      <div class="sw-editorial"><div><h3>${pick('Meine Publikationen im Netz','My online publications')}</h3><p>${esc(t.note)}</p></div><ul>${t.items.map(item => `<li><a class="portal-link" href="${esc(item.url)}">${item.logo ? `<img src="${P}${esc(item.logo)}" alt="" width="36" height="36" loading="lazy">` : `<span class="portal-initial" aria-hidden="true">${esc(item.initial)}</span>`}${esc(item.name)}</a><p>${esc(item.desc)}</p></li>`).join('')}</ul></div>
      <div class="sw-editorial subdomains"><div><h3>${pick('Tools auf meinen Subdomains','Tools on my subdomains')}</h3></div><ul>${projects.filter(p=>new URL(p.url).hostname.endsWith('.philipp-paulik.de')).map(p=>`<li><a href="${esc(p.url)}">${esc(p.name)}</a><p>${esc(p[lang].type)} · ${esc(new URL(p.url).hostname)}</p></li>`).join('')}<li><a href="https://db.philipp-paulik.de/" rel="nofollow">Analytics Studio</a><p>${pick('Privates Dashboard','Private dashboard')} · db.philipp-paulik.de</p></li></ul></div>
    </div>
  </section>`;
}
