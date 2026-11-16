const $=id=>document.getElementById(id);
const roleMeta=document.querySelector('meta[name="content-role"]')?.content;const role=['lp','ads','news'].includes(roleMeta)?roleMeta:'blog';const custom=role!=='blog';
const site=location.hostname.replace(/^(blog|lp|ads|news)\./,'');
const words=role==='news'
  ?{one:'Newsletter',many:'Newsletter',fresh:'Neuer Newsletter'}
  :role==='ads'
  ?{one:'Anzeige',many:'Anzeigen',fresh:'Neue Anzeige'}
  :role==='lp'
  ?{one:'Landing Page',many:'Landing Pages',fresh:'Neue Landing Page'}
  :{one:'Beitrag',many:'Beiträge',fresh:'Neuer Beitrag'};
let csrf='',editing=null;
const say=text=>$('status').textContent=text;
async function api(path,{method='GET',data}={}) {
  const headers={};if(csrf)headers['x-csrf-token']=csrf;if(data!==undefined)headers['content-type']='application/json';
  const r=await fetch(path,{method,headers,body:data!==undefined?JSON.stringify(data):null,credentials:'same-origin',cache:'no-store'});
  if(!r.ok){if(r.status===401)lock();throw new Error(r.status===401?'Bitte erneut anmelden.':r.status===409?'Kurzname oder Pfad ist schon vergeben.':r.status===413?'Limit erreicht. Bitte alte Inhalte entfernen oder Code kürzen.':r.status===400?'Bitte Eingaben prüfen (Titel, Slug, Text, Code, Pfad).':'Aktion nicht möglich. Bitte erneut versuchen.');}
  return r.status===204?null:r.json();
}
function lock(){csrf='';editing=null;$('console').hidden=true;$('logout').hidden=true;$('gate').hidden=false;$('items').replaceChildren();$('password').value='';resetEditor();}
function wrapSel(a,b,ph){const t=$('f-text'),s0=t.selectionStart,e0=t.selectionEnd,sel=t.value.slice(s0,e0)||ph;t.setRangeText(a+sel+b,s0,e0,'select');t.focus();}
function prefixLines(pre,numbered){const t=$('f-text'),s0=t.value.lastIndexOf('\n',t.selectionStart-1)+1;let e0=t.value.indexOf('\n',t.selectionEnd);if(e0<0)e0=t.value.length;const lines=t.value.slice(s0,e0).split('\n').map((l,i)=>(numbered?`${i+1}. `:pre)+l.replace(/^(#{2,3} |[-*] |\d+\. |> ?)/,''));t.setRangeText(lines.join('\n'),s0,e0,'select');t.focus();}
function initRichtext(){
  if(role!=='blog')return;
  $('rt-bar').hidden=false;$('rt-image').hidden=false;$('rt-help').textContent='Formatierung über die Knöpfe oder Markdown: **fett**, *kursiv*, ## Überschrift, - Liste, > Zitat. Bilder nur aus deiner Dateiverwaltung (static.), die Datei muss freigegeben sein.';
  const acts={bold:()=>wrapSel('**','**','Text'),italic:()=>wrapSel('*','*','Text'),h2:()=>prefixLines('## '),h3:()=>prefixLines('### '),ul:()=>prefixLines('- '),ol:()=>prefixLines('',true),quote:()=>prefixLines('> '),link:()=>{const u=prompt('Link (https://…)');if(!u)return;if(!/^(https:\/\/|mailto:)/.test(u)){say('Nur https- oder mailto-Links.');return;}wrapSel('[',`](${u})`,'Linktext');}};
  for(const b of $('rt-bar').querySelectorAll('button'))b.addEventListener('click',()=>acts[b.dataset.rt]());
  $('rt-insert').addEventListener('click',()=>{const o=$('rt-file').selectedOptions[0];if(!o||!o.dataset.url)return say('Erst eine freigegebene Datei auswählen.');const t=$('f-text'),alt=$('rt-alt').value.replace(/[\[\]\n]/g,' ').trim(),block=`![${alt}](${o.dataset.url})`;const pre=t.value&&!t.value.endsWith('\n\n')?(t.value.endsWith('\n')?'\n':'\n\n'):'';t.setRangeText(pre+block+'\n\n',t.selectionStart,t.selectionEnd,'end');$('rt-alt').value='';t.focus();});
  loadRtFiles();
}
async function loadRtFiles(){const {files}=await api('/api/assets');const sel=$('rt-file');sel.replaceChildren();const shared=files.filter(f=>f.shared&&/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f.name));if(!shared.length){const o=document.createElement('option');o.textContent='Keine freigegebenen Bilder - auf static. hochladen und freigeben';o.value='';sel.append(o);return;}for(const f of shared){const o=document.createElement('option');o.value=f.id;o.dataset.url=f.url;o.textContent=f.name;sel.append(o);}}
async function show(){const s=await api('/api/session');csrf=s.csrf;$('gate').hidden=true;$('console').hidden=false;$('logout').hidden=false;await refresh();if(custom)refreshAssets();initRichtext();}
async function action(button,fn){button.disabled=true;say('');try{await fn();}catch(e){say(e.message);}finally{button.disabled=false;}}
function button(text,fn,kind='secondary'){const b=document.createElement('button');b.type='button';b.textContent=text;b.className=kind;b.addEventListener('click',()=>action(b,fn));return b;}
const publicURL=slug=>role==='blog'?`https://blog.${site}/${slug}`:`https://${role}.${site}/${slug}`;
const paragraphsFromText=text=>text.split(/\n{2,}/).map(p=>p.trim()).filter(Boolean);
const textFromParagraphs=list=>list.join('\n\n');

// --- Custom code editors (Monaco or CodeMirror, both vendored locally) ---
const code={html:'',css:'',js:''};
let currentTab='html',engine=null,engineName='';
const preferredEngine=()=>localStorage.getItem('lp-editor')||'monaco';
async function createEditor(name){
  if(name==='codemirror'){
    const m=await import('/vendor/codemirror.js');
    return m.createCodeMirror({parent:$('editor-host'),language:currentTab,value:code[currentTab],onChange:v=>code[currentTab]=v});
  }
  if(!document.getElementById('monaco-css')){const l=document.createElement('link');l.id='monaco-css';l.rel='stylesheet';l.href='/vendor/monaco/monaco.css';document.head.append(l);}
  const m=await import('/vendor/monaco/monaco.js');
  return m.createMonaco({parent:$('editor-host'),language:currentTab,value:code[currentTab],onChange:v=>code[currentTab]=v});
}
async function openEditor(name){
  if(engine){code[currentTab]=engine.value;engine.destroy();engine=null;}
  $('editor-host').replaceChildren();
  engine=await createEditor(name);engineName=name;
  $('engine-monaco').setAttribute('aria-pressed',name==='monaco');
  $('engine-codemirror').setAttribute('aria-pressed',name==='codemirror');
  localStorage.setItem('lp-editor',name);
}
function closeEditor(){if(engine){engine.destroy();engine=null;engineName='';}$('editor-host').replaceChildren();}
function setTab(tab){if(!engine)return;code[currentTab]=engine.value;currentTab=tab;engine.setLanguage(tab);engine.setValue(code[tab]);for(const b of $('code-tabs').querySelectorAll('[data-tab]'))b.classList.toggle('active',b.dataset.tab===tab);}
function setCustomMode(on){
  $('code-area').hidden=!on;$('text-field').hidden=on;$('cta-fields').hidden=on||!custom;
  if(on&&!engine)openEditor(preferredEngine()).catch(()=>say('Editor konnte nicht geladen werden.'));
  if(!on)closeEditor();
}
$('f-custom-toggle').addEventListener('change',e=>setCustomMode(e.target.checked));
for(const b of $('code-tabs').querySelectorAll('[data-tab]'))b.addEventListener('click',()=>setTab(b.dataset.tab));
$('engine-monaco').addEventListener('click',()=>action($('engine-monaco'),async()=>{if(engineName!=='monaco')await openEditor('monaco');}));
$('engine-codemirror').addEventListener('click',()=>action($('engine-codemirror'),async()=>{if(engineName!=='codemirror')await openEditor('codemirror');}));

function resetEditor(){editing=null;closeEditor();code.html='';code.css='';code.js='';currentTab='html';$('editor').reset();if(custom){$('f-custom-toggle').checked=false;$('code-area').hidden=true;$('text-field').hidden=false;$('cta-fields').hidden=false;}for(const b of $('code-tabs').querySelectorAll('[data-tab]'))b.classList.toggle('active',b.dataset.tab==='html');$('f-slug').disabled=false;$('editor-title').textContent=words.fresh;$('editor-status').hidden=true;$('save').textContent='Als Entwurf speichern';$('publish').textContent='Veröffentlichen';$('preview').hidden=true;$('delete').hidden=true;$('cancel').hidden=true;}
async function load(slug){
  const item=await api('/api/content/'+slug);editing=item;
  $('f-title').value=item.title;$('f-slug').value=item.slug;$('f-slug').disabled=true;$('f-text').value=textFromParagraphs(item.paragraphs);
  if(custom){
    $('f-cta-label').value=item.cta_label||'';$('f-cta-url').value=item.cta_url||'';$('f-hero').value=item.hero_image||'';
    const hasCustom=!!item.custom_html;$('f-custom-toggle').checked=hasCustom;
    code.html=item.custom_html||'';code.css=item.custom_css||'';code.js=item.custom_js||'';currentTab='html';
    for(const b of $('code-tabs').querySelectorAll('[data-tab]'))b.classList.toggle('active',b.dataset.tab==='html');
    setCustomMode(hasCustom);
  }
  $('editor-title').textContent=item.title;
  const live=item.status==='published';$('editor-status').hidden=false;$('editor-status').textContent=live?'Veröffentlicht':'Entwurf';$('editor-status').className='pill'+(live?' live':'');
  $('save').textContent='Änderungen speichern';$('publish').textContent=live?'Zurück auf Entwurf':'Veröffentlichen';$('preview').hidden=false;$('delete').hidden=false;$('cancel').hidden=false;scrollTo({top:0,behavior:'smooth'});
}
async function save(){
  if(custom&&engine)code[currentTab]=engine.value;
  const customOn=custom&&$('f-custom-toggle').checked;
  const data={title:$('f-title').value,paragraphs:paragraphsFromText($('f-text').value)};
  if(custom){
    if(customOn){
      if(!code.html.trim())throw new Error('Eigenes HTML ist leer. Entweder HTML schreiben oder den Schalter aus lassen.');
      data.custom={html:code.html,css:code.css,js:code.js};data.paragraphs=[];data.cta=null;data.hero_image=null;
    }else{
      data.custom=null;
      if(!data.paragraphs.length)throw new Error('Bitte mindestens einen Absatz schreiben.');
      const label=$('f-cta-label').value.trim(),url=$('f-cta-url').value.trim();
      if((label&&!url)||(!label&&url))throw new Error('Der Button braucht Beschriftung und Ziel - oder beide Felder leer lassen.');
      data.cta=label?{label,url}:null;data.hero_image=$('f-hero').value.trim()||null;
    }
  }else if(!data.paragraphs.length)throw new Error('Bitte mindestens einen Absatz schreiben.');
  if(editing){await api('/api/content/'+editing.slug,{method:'POST',data});return editing.slug;}
  if($('f-slug').value.trim())data.slug=$('f-slug').value.trim();
  return (await api('/api/content',{method:'POST',data})).slug;
}
async function refresh(){
  const {items}=await api('/api/content');$('items').replaceChildren();
  for(const item of items){
    const live=item.status==='published';
    const outer=document.createElement('article');outer.className='item';
    const text=document.createElement('div');const strong=document.createElement('strong');strong.textContent=item.title;
    const url=document.createElement('span');url.className='url';url.textContent=live?publicURL(item.slug):'Entwurf · Noch nicht öffentlich';
    const d=document.createElement('div');d.className='details';d.textContent=`${live?'Veröffentlicht':'Entwurf'} · Geändert: ${new Date(item.updated).toLocaleString('de-DE')} · /${item.slug}`+(item.has_custom?' · Eigenes HTML/CSS/JS':'')+(custom&&!item.has_custom?(item.cta_label?' · Button: '+item.cta_label:'')+(item.hero_image?' · Hero-Bild':''):'');
    text.append(strong,url,d);
    const actions=document.createElement('div');actions.className='actions';
    actions.append(button('Bearbeiten',async()=>{await load(item.slug);}));
    actions.append(button(live?'Zurückziehen':'Veröffentlichen',async()=>{await api(`/api/content/${item.slug}/status`,{method:'POST',data:{status:live?'draft':'published'}});await refresh();say(live?'Zurück auf Entwurf. Nicht mehr öffentlich erreichbar.':'Veröffentlicht.');}));
    if(live&&role!=='news')actions.append(button('Live-URL kopieren',async()=>{await navigator.clipboard.writeText(publicURL(item.slug));say('Live-URL kopiert.');}));
    if(live&&custom&&role!=='news')actions.append(button('Tracking-Link',async()=>{$('t-slug').value=item.slug;$('track-card').scrollIntoView({behavior:'smooth'});$('t-source').focus();}));
    actions.append(button('Löschen',async()=>{if(!confirm(`${words.one} „${item.title}“ dauerhaft löschen?`))return;await api('/api/content/'+item.slug,{method:'DELETE'});if(editing?.slug===item.slug)resetEditor();await refresh();say('Gelöscht.');},'danger'));
    outer.append(text,actions);$('items').append(outer);
  }
  if(!items.length)$('items').textContent=`Noch keine ${words.many} angelegt.`;
  if(custom&&role!=='news'){const sel=$('t-slug'),keep=sel.value;sel.replaceChildren();for(const i of items.filter(i=>i.status==='published')){const o=document.createElement('option');o.value=i.slug;o.textContent=`${i.title} (/${i.slug})`;sel.append(o);}if(keep)sel.value=keep;$('track-card').hidden=!sel.options.length;}
}
// --- Virtual file paths to static.* (lp only) ---
async function refreshAssets(){
  const {files,vpaths}=await api('/api/assets');
  const select=$('vp-file');select.replaceChildren();
  if(!files.length){const o=document.createElement('option');o.value='';o.textContent='Keine Dateien - erst auf static. hochladen';select.append(o);}
  for(const f of files){const o=document.createElement('option');o.value=f.id;o.textContent=`${f.name}${f.shared?'':' (privat - Pfad antwortet 404 bis freigegeben)'}`;select.append(o);}
  $('vpaths').replaceChildren();
  for(const p of vpaths){
    const outer=document.createElement('article');outer.className='item';
    const text=document.createElement('div');const strong=document.createElement('strong');strong.textContent=p.path;
    const d=document.createElement('div');d.className='details';d.textContent=`→ ${p.file_name??'Datei gelöscht'} · ${p.shared?'freigegeben':'Datei privat - Pfad antwortet 404'}`;
    text.append(strong,d);
    const actions=document.createElement('div');actions.className='actions';
    actions.append(button('Kopieren',async()=>{await navigator.clipboard.writeText(p.path);say('Pfad kopiert. Im Code als '+p.path+' verwenden.');}));
    actions.append(button('Löschen',async()=>{if(!confirm(`Pfad ${p.path} löschen? Die Datei auf static. bleibt.`))return;await api('/api/vpaths',{method:'DELETE',data:{path:p.path}});await refreshAssets();say('Pfad gelöscht.');},'danger'));
    outer.append(text,actions);$('vpaths').append(outer);
  }
  if(!vpaths.length)$('vpaths').textContent='Noch keine Pfade verknüpft.';
}
if(custom){
  $('open-static').href=`https://static.${site}/`;
  $('new-vpath').addEventListener('submit',e=>{e.preventDefault();action(e.submitter,async()=>{
    const path=$('vp-path').value.trim(),file_id=$('vp-file').value;
    if(!path.startsWith('/'))throw new Error('Pfad muss mit / beginnen, zum Beispiel /bilder/cover.jpg');
    if(!file_id)throw new Error('Keine Datei vorhanden. Erst auf static. hochladen.');
    await api('/api/vpaths',{method:'POST',data:{path,file_id}});$('vp-path').value='';await refreshAssets();say('Pfad verknüpft.');
  });});
}
document.querySelector('header>a').href='https://'+site;
if(custom){$('f-title').placeholder=role==='ads'?'Zum Beispiel: Herbst-Kampagne 1080x1080':'Zum Beispiel: Mein neues Angebot';$('cta-fields').hidden=false;$('custom-fields').hidden=false;$('files-card').hidden=false;$('public-link').hidden=true;}
else{$('public-link').href=`https://blog.${site}/`;}
$('login').addEventListener('submit',e=>{e.preventDefault();action(e.submitter,async()=>{const password=$('password').value,email=$('email').value;$('password').value='';const s=await api('/api/login',{method:'POST',data:{email,password}});csrf=s.csrf;await show();say('Angemeldet.');});});
$('logout').addEventListener('click',()=>action($('logout'),async()=>{await api('/api/logout',{method:'POST'});lock();say('Abgemeldet.');}));
$('editor').addEventListener('submit',e=>{e.preventDefault();action(e.submitter,async()=>{const slug=await save();await refresh();await load(slug);say('Gespeichert.');});});
$('publish').addEventListener('click',()=>action($('publish'),async()=>{const slug=await save();const live=editing&&$('editor-status').textContent==='Veröffentlicht';await api(`/api/content/${slug}/status`,{method:'POST',data:{status:live?'draft':'published'}});await refresh();await load(slug);say(live?'Zurück auf Entwurf. Nicht mehr öffentlich erreichbar.':'Veröffentlicht. Jetzt öffentlich erreichbar.');}));
$('preview').addEventListener('click',()=>action($('preview'),async()=>{const slug=await save();await refresh();open('/preview/'+slug,'_blank','noopener');}));
$('delete').addEventListener('click',()=>action($('delete'),async()=>{if(!editing||!confirm(`${words.one} „${editing.title}“ dauerhaft löschen?`))return;await api('/api/content/'+editing.slug,{method:'DELETE'});resetEditor();await refresh();say('Gelöscht.');}));
$('cancel').addEventListener('click',()=>{resetEditor();say('');});
resetEditor();show().catch(()=>lock());

if(custom&&role!=='news'){$('track-form').addEventListener('submit',e=>{e.preventDefault();action(e.submitter,async()=>{
  const utm={};for(const k of ['source','medium','campaign','term','content']){const v=$('t-'+k).value.trim();if(v)utm[k]=v;}
  const r=await api('/api/tracking-link',{method:'POST',data:{slug:$('t-slug').value,utm}});
  const row=document.createElement('article');row.className='item';const t=document.createElement('div');const a=document.createElement('strong');a.textContent=r.short;const d=document.createElement('div');d.className='details';d.textContent='→ '+r.target;t.append(a,d);
  const acts=document.createElement('div');acts.className='actions';acts.append(button('Kopieren',async()=>{await navigator.clipboard.writeText(r.short);say('Kurzlink kopiert.');}));row.append(t,acts);$('t-result').prepend(row);say('Kurzlink erstellt. Klicks zählt l.');
});});}
