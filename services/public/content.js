const $=id=>document.getElementById(id);
const role=document.querySelector('meta[name="content-role"]')?.content==='lp'?'lp':'blog';
const site=location.hostname.replace(/^(blog|lp)\./,'');
const words=role==='lp'
  ?{one:'Landing Page',many:'Landing Pages',fresh:'Neue Landing Page',intro:'Landing Pages als Entwurf anlegen, prüfen und dann bewusst veröffentlichen.'}
  :{one:'Beitrag',many:'Beiträge',fresh:'Neuer Beitrag',intro:'Blogbeiträge als Entwurf anlegen, prüfen und dann bewusst veröffentlichen.'};
let csrf='',editing=null;
const say=text=>$('status').textContent=text;
async function api(path,{method='GET',data}={}) {
  const headers={};if(csrf)headers['x-csrf-token']=csrf;if(data!==undefined)headers['content-type']='application/json';
  const r=await fetch(path,{method,headers,body:data!==undefined?JSON.stringify(data):null,credentials:'same-origin',cache:'no-store'});
  if(!r.ok){if(r.status===401)lock();throw new Error(r.status===401?'Bitte erneut anmelden.':r.status===409?'Dieser Kurzname ist schon vergeben.':r.status===413?'Limit erreicht. Bitte alte Inhalte entfernen.':r.status===400?'Bitte Titel, Kurznamen und Text prüfen.':'Aktion nicht möglich. Bitte erneut versuchen.');}
  return r.status===204?null:r.json();
}
function lock(){csrf='';editing=null;$('console').hidden=true;$('logout').hidden=true;$('gate').hidden=false;$('items').replaceChildren();$('password').value='';resetEditor();}
async function show(){const s=await api('/api/session');csrf=s.csrf;$('gate').hidden=true;$('console').hidden=false;$('logout').hidden=false;await refresh();}
async function action(button,fn){button.disabled=true;say('');try{await fn();}catch(e){say(e.message);}finally{button.disabled=false;}}
function button(text,fn,kind='secondary'){const b=document.createElement('button');b.type='button';b.textContent=text;b.className=kind;b.addEventListener('click',()=>action(b,fn));return b;}
const publicURL=slug=>role==='blog'?`https://blog.${site}/${slug}`:`https://lp.${site}/${slug}`;
const paragraphsFromText=text=>text.split(/\n{2,}/).map(p=>p.trim()).filter(Boolean);
const textFromParagraphs=list=>list.join('\n\n');
function resetEditor(){editing=null;$('editor').reset();$('f-slug').disabled=false;$('editor-eyebrow').textContent='NEU';$('editor-title').textContent=words.fresh;$('editor-status').hidden=true;$('save').textContent='Als Entwurf speichern';$('publish').textContent='Veröffentlichen';$('preview').hidden=true;$('delete').hidden=true;$('cancel').hidden=true;}
async function load(slug){const item=await api('/api/content/'+slug);editing=item;$('f-title').value=item.title;$('f-slug').value=item.slug;$('f-slug').disabled=true;$('f-text').value=textFromParagraphs(item.paragraphs);if(role==='lp'){$('f-cta-label').value=item.cta_label||'';$('f-cta-url').value=item.cta_url||'';$('f-hero').value=item.hero_image||'';}$('editor-eyebrow').textContent='BEARBEITEN';$('editor-title').textContent=item.title;const live=item.status==='published';$('editor-status').hidden=false;$('editor-status').textContent=live?'Veröffentlicht':'Entwurf';$('editor-status').className='pill'+(live?' live':'');$('save').textContent='Änderungen speichern';$('publish').textContent=live?'Zurück auf Entwurf':'Veröffentlichen';$('preview').hidden=false;$('delete').hidden=false;$('cancel').hidden=false;scrollTo({top:0,behavior:'smooth'});}
async function save(){const data={title:$('f-title').value,paragraphs:paragraphsFromText($('f-text').value)};if(!data.paragraphs.length)throw new Error('Bitte mindestens einen Absatz schreiben.');if(role==='lp'){const label=$('f-cta-label').value.trim(),url=$('f-cta-url').value.trim();if((label&&!url)||(!label&&url))throw new Error('Der Button braucht Beschriftung und Ziel - oder beide Felder leer lassen.');data.cta=label?{label,url}:null;data.hero_image=$('f-hero').value.trim()||null;}if(editing){await api('/api/content/'+editing.slug,{method:'POST',data});return editing.slug;}if($('f-slug').value.trim())data.slug=$('f-slug').value.trim();return (await api('/api/content',{method:'POST',data})).slug;}
async function refresh(){
  const {items}=await api('/api/content');$('items').replaceChildren();
  for(const item of items){
    const live=item.status==='published';
    const outer=document.createElement('article');outer.className='item';
    const text=document.createElement('div');const strong=document.createElement('strong');strong.textContent=item.title;
    const url=document.createElement('span');url.className='url';url.textContent=live?publicURL(item.slug):'Entwurf · Noch nicht öffentlich';
    const d=document.createElement('div');d.className='details';d.textContent=`${live?'Veröffentlicht':'Entwurf'} · Zuletzt geändert: ${new Date(item.updated).toLocaleString('de-DE')} · /${item.slug}`+(role==='lp'?(item.cta_label?' · Button: '+item.cta_label:'')+(item.hero_image?' · Hero-Bild':''):'');
    text.append(strong,url,d);
    const actions=document.createElement('div');actions.className='actions';
    actions.append(button('Bearbeiten',async()=>{await load(item.slug);}));
    actions.append(button(live?'Zurückziehen':'Veröffentlichen',async()=>{await api(`/api/content/${item.slug}/status`,{method:'POST',data:{status:live?'draft':'published'}});await refresh();say(live?'Zurück auf Entwurf. Nicht mehr öffentlich erreichbar.':'Veröffentlicht.');}));
    if(live)actions.append(button('Kopieren',async()=>{await navigator.clipboard.writeText(publicURL(item.slug));say('Öffentlicher Link kopiert.');}));
    actions.append(button('Löschen',async()=>{if(!confirm(`${words.one} „${item.title}“ dauerhaft löschen?`))return;await api('/api/content/'+item.slug,{method:'DELETE'});if(editing?.slug===item.slug)resetEditor();await refresh();say('Gelöscht.');},'danger'));
    outer.append(text,actions);$('items').append(outer);
  }
  if(!items.length)$('items').textContent=`Noch keine ${words.many} angelegt.`;
}
$('eyebrow').textContent=site.toUpperCase()+' / VERWALTUNG';
$('intro').textContent=words.intro;
if(role==='lp')$('f-title').placeholder='Zum Beispiel: Mein neues Angebot';
if(role==='lp')$('cta-fields').hidden=false;
document.querySelector('header>a').href='https://'+site;
if(role==='blog'){$('public-link').href=`https://blog.${site}/`;}else{$('public-link').hidden=true;}
$('login').addEventListener('submit',e=>{e.preventDefault();action(e.submitter,async()=>{const password=$('password').value;$('password').value='';const s=await api('/api/login',{method:'POST',data:{password}});csrf=s.csrf;await show();say('Verwaltung geöffnet.');});});
$('logout').addEventListener('click',()=>action($('logout'),async()=>{await api('/api/logout',{method:'POST'});lock();say('Abgemeldet.');}));
$('editor').addEventListener('submit',e=>{e.preventDefault();action(e.submitter,async()=>{const slug=await save();await refresh();await load(slug);say('Gespeichert.');});});
$('publish').addEventListener('click',()=>action($('publish'),async()=>{const slug=await save();const live=editing&&$('editor-status').textContent==='Veröffentlicht';await api(`/api/content/${slug}/status`,{method:'POST',data:{status:live?'draft':'published'}});await refresh();await load(slug);say(live?'Zurück auf Entwurf. Nicht mehr öffentlich erreichbar.':'Veröffentlicht. Jetzt öffentlich erreichbar.');}));
$('preview').addEventListener('click',()=>{if(editing)open('/preview/'+editing.slug,'_blank','noopener');});
$('delete').addEventListener('click',()=>action($('delete'),async()=>{if(!editing||!confirm(`${words.one} „${editing.title}“ dauerhaft löschen?`))return;await api('/api/content/'+editing.slug,{method:'DELETE'});resetEditor();await refresh();say('Gelöscht.');}));
$('cancel').addEventListener('click',()=>{resetEditor();say('');});
resetEditor();show().catch(()=>lock());
