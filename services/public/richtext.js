// WYSIWYG blog editor: contenteditable <-> the small Markdown-like block format
// the server renders. Built with DOM APIs only (no innerHTML on author data).
(()=>{
const STATIC=()=>`https://static.${(window.__site||location.hostname.replace(/^[^.]+\./,''))}/`;
function inline(text,parent){
  const re=/!\[([^\]\n]{0,200})\]\((https:\/\/[^\s)]{1,500})\)|\[([^\]\n]{1,200})\]\(((?:https:\/\/|mailto:)[^\s)]{1,500})\)|`([^`\n]{1,200})`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let last=0,m;
  while((m=re.exec(text))){
    if(m.index>last)parent.append(text.slice(last,m.index));
    if(m[2]!==undefined){if(m[2].startsWith(STATIC())){const i=document.createElement('img');i.src=m[2];i.alt=m[1];parent.append(i);}else parent.append(m[0]);}
    else if(m[4]!==undefined){const a=document.createElement('a');a.href=m[4];a.textContent=m[3];parent.append(a);}
    else if(m[5]!==undefined){const c=document.createElement('code');c.textContent=m[5];parent.append(c);}
    else if(m[6]!==undefined){const s=document.createElement('strong');inline(m[6],s);parent.append(s);}
    else{const e=document.createElement('em');inline(m[7],e);parent.append(e);}
    last=re.lastIndex;
  }
  if(last<text.length)parent.append(text.slice(last));
}
function lines(text,parent){text.split('\n').forEach((l,i)=>{if(i)parent.append(document.createElement('br'));inline(l,parent);});}
function block(src){
  const ls=String(src).split('\n').filter(l=>l.trim());if(!ls.length)return null;
  let m;
  if(ls.length===1&&(m=/^(#{2,3}) (.+)$/.exec(ls[0]))){const h=document.createElement('h'+m[1].length);inline(m[2],h);return h;}
  const list=(tag,re)=>{const e=document.createElement(tag);for(const l of ls){const li=document.createElement('li');inline(l.replace(re,''),li);e.append(li);}return e;};
  if(ls.every(l=>/^[-*] /.test(l)))return list('ul',/^[-*] /);
  if(ls.every(l=>/^\d+\. /.test(l)))return list('ol',/^\d+\. /);
  if(ls.every(l=>/^> ?/.test(l))){const q=document.createElement('blockquote');q.append(...[].concat(...ls.map((l,i)=>{const s=document.createElement('span');inline(l.replace(/^> ?/,''),s);return i?[document.createElement('br'),s]:[s];})));return q;}
  const p=document.createElement('p');lines(ls.join('\n'),p);return p;
}
function setBlocks(root,blocks){root.replaceChildren();for(const b of blocks){const e=block(b);if(e)root.append(e);}if(!root.firstChild){root.append(document.createElement('p'));}}
function ser(node){
  let out='';
  for(const n of node.childNodes){
    if(n.nodeType===3){out+=n.textContent.replace(/\u00a0/g,' ');continue;}
    if(n.nodeType!==1)continue;
    const t=n.tagName.toLowerCase(),inner=()=>ser(n);
    if(t==='br')out+='\n';
    else if(t==='strong'||t==='b'){const s=inner();out+=s.trim()?`**${s}**`:s;}
    else if(t==='em'||t==='i'){const s=inner();out+=s.trim()?`*${s}*`:s;}
    else if(t==='code')out+='`'+inner().replace(/`/g,'')+'`';
    else if(t==='a'){const h=n.getAttribute('href')||'';out+=/^(https:\/\/|mailto:)/.test(h)?`[${inner().replace(/[\[\]]/g,'')}](${h})`:inner();}
    else if(t==='img'){const s=n.getAttribute('src')||'';if(s.startsWith(STATIC()))out+=`![${(n.getAttribute('alt')||'').replace(/[\[\]\n]/g,' ')}](${s})`;}
    else out+=inner();
  }
  return out;
}
const BLOCKS='h1,h2,h3,h4,ul,ol,blockquote,p,figure,div';
function getBlocks(root){
  const blocks=[];
  const push=s=>{s=s.replace(/[ \t]+\n/g,'\n').replace(/\n{2,}/g,'\n').trim();if(s)blocks.push(s);};
  const walk=parent=>{
    let loose='';
    const flush=()=>{push(loose);loose='';};
    for(const n of parent.childNodes){
      if(n.nodeType===3){loose+=n.textContent;continue;}
      if(n.nodeType!==1)continue;
      const t=n.tagName.toLowerCase();
      if(!/^(h[1-4]|ul|ol|blockquote|p|figure|div)$/.test(t)){loose+=ser({childNodes:[n]});continue;}
      flush();
      if(n.querySelector('ul,ol,blockquote,figure,h1,h2,h3,h4,p,div')&&!/^(ul|ol)$/.test(t)){walk(n);continue;}
      if(t==='h1'||t==='h2')push('## '+ser(n).replace(/\n/g,' '));
      else if(t==='h3'||t==='h4')push('### '+ser(n).replace(/\n/g,' '));
      else if(t==='ul')push([...n.children].map(li=>'- '+ser(li).replace(/\n/g,' ')).join('\n'));
      else if(t==='ol')push([...n.children].map((li,i)=>`${i+1}. `+ser(li).replace(/\n/g,' ')).join('\n'));
      else if(t==='blockquote')push(ser(n).split('\n').filter(l=>l.trim()).map(l=>'> '+l).join('\n'));
      else push(ser(n));
    }
    flush();
  };
  walk(root);
  return blocks;
}
window.Richtext={setBlocks,getBlocks};
})();
