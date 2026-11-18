// Safe rich text for blog posts. Authors write a small Markdown-like syntax;
// everything is escaped first, then a fixed set of tags is produced. Links are
// https/mailto only, images only from the tenant's own static.* host.
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderInline(text, site) {
  const staticPrefix = `https://static.${site}/`;
  const stash = [];
  const keep = html => `\u0000${stash.push(html) - 1}\u0000`;
  let s = String(text);
  s = s.replace(/!\[([^\]\n]{0,200})\]\((https:\/\/[^\s)]{1,500})\)/g, (m, alt, url) =>
    url.startsWith(staticPrefix) ? keep(`<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`) : m);
  s = s.replace(/\[([^\]\n]{1,200})\]\(((?:https:\/\/|mailto:)[^\s)]{1,500})\)/g, (m, label, url) =>
    keep(`<a href="${esc(url)}" rel="noopener noreferrer">${esc(label)}</a>`));
  s = s.replace(/`([^`\n]{1,200})`/g, (m, code) => keep(`<code>${esc(code)}</code>`));
  s = esc(s)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[Number(i)] ?? '');
}

export function renderBlock(block, site) {
  const lines = String(block).split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.length);
  if (!lines.length) return '';
  const inline = t => renderInline(t, site);
  const heading = /^(#{2,3}) (.+)$/.exec(lines[0]);
  if (heading && lines.length === 1) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
  if (lines.every(l => /^[-*] /.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
  if (lines.every(l => /^\d+\. /.test(l))) return `<ol>${lines.map(l => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`;
  if (lines.every(l => /^> ?/.test(l))) return `<blockquote>${lines.map(l => inline(l.replace(/^> ?/, ''))).join('<br>')}</blockquote>`;
  if (lines.length === 1 && /^!\[[^\]]*\]\(https:\/\/[^\s)]+\)$/.test(lines[0])) {
    const html = inline(lines[0]);
    if (html.startsWith('<img')) return `<figure>${html}</figure>`;
  }
  return `<p>${lines.map(inline).join('<br>')}</p>`;
}

export const renderBlocks = (blocks, site) => blocks.map(b => renderBlock(b, site)).join('');
export const plainExcerpt = text => String(text).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`#>]/g, '').replace(/^\d+\. |^- /gm, '').replace(/\s+/g, ' ').trim();
