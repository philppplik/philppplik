const $=id=>document.getElementById(id);let csrf='';var siteName='';
const say=t=>$('status').textContent=t;
async function api(path,{method='GET',data,raw}={}){const h={};if(csrf)h['x-csrf-token']=csrf;if(data!==undefined)h['content-type']='application/json';const r=await fetch(path,{method,headers:h,body:raw!==undefined?raw:data!==undefined?JSON.stringify(data):null,credentials:'same-origin',cache:'no-store'});if(!r.ok){if(r.status===401)lock();throw new Error(r.status===401?'Bitte erneut anmelden.':r.status===429?'Zu viele Anmeldeversuche. Bitte später erneut versuchen.':'Aktion nicht möglich.');}return r.status===204?null:r.json();}
function lock(){csrf='';$('console').hidden=true;$('logout').hidden=true;$('gate').hidden=false;$('password').value='';}
function tile(title,href,detail){const a=document.createElement('article');a.className='item';const t=document.createElement('div');const s=document.createElement('strong');s.textContent=title;const d=document.createElement('div');d.className='details';d.textContent=detail;t.append(s,d);const acts=document.createElement('div');acts.className='actions';const l=document.createElement('a');l.href=href;l.textContent='Öffnen ↗';l.rel='noopener';acts.append(l);a.append(t,acts);return a;}
async function show(){const s=await api('/api/session');csrf=s.csrf;siteName=s.site;$('gate').hidden=true;$('console').hidden=false;$('logout').hidden=false;await loadTiles();await loadImages();await loadNewsletter();}
async function loadNewsletter(){
 const box=$('nl');if(!box)return;
 try{const n=await api('/api/newsletter/subscribers');const c=n.counts||{};box.textContent=`${c.active||0} Abonnenten · ${c.pending||0} unbestätigt · ${c.unsubscribed||0} abgemeldet. `+(n.sendEnabled?'Versand ist eingerichtet.':'Versand ist noch nicht eingerichtet.');}catch(e){box.textContent='Newsletter-Verwaltung ist auf diesem Stand noch nicht verfügbar.';}
}
async function loadTiles(){const o=await api('/api/overview');
 const c=x=>`${x.published} live · ${x.drafts} Entwürfe`;
 $('tiles').replaceChildren(tile('Landing Pages',o.hosts.lp,c(o.lp)),tile('Anzeigen',o.hosts.ads,c(o.ads)),tile('Blog',o.hosts.blog,c(o.blog)),tile('Newsletter',`https://m.${o.site}/newsletter`,`${o.news?o.news.drafts:0} Entwürfe`),tile('Kurzlinks und Tracking',o.hosts.links,`${o.links} Links · ${o.clicks} Weiterleitungen`),tile('Dateien und Bilder',o.hosts.files,`${o.files} Dateien · ${o.sharedFiles} freigegeben`),tile('Besucherstatistik',o.hosts.analytics,'GA4 und Kurzlink-Klicks'));}
$('login').addEventListener('submit',e=>{e.preventDefault();const b=e.submitter;b.disabled=true;(async()=>{try{const password=$('password').value,email=$('email').value;$('password').value='';const s=await api('/api/login',{method:'POST',data:{email,password}});csrf=s.csrf;await show();say('Angemeldet.');}catch(x){say(x.message);}finally{b.disabled=false;}})();});
$('logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'});}catch{}lock();say('Abgemeldet.');});
show().catch(()=>lock());

// --- Bilder: upload, freigeben, löschen (gleiche Dateien wie static.) ---
async function loadImages(){
  let f;try{f=await api('/api/files');}catch(e){$('images').textContent='Bilder konnten nicht geladen werden: '+e.message;return;}const list=$('images');list.replaceChildren();
  const imgs=f.files.filter(x=>/\.(png|jpe?g|gif|webp|avif)$/i.test(x.name));
  if(!imgs.length){list.textContent='Noch keine Bilder.';return;}
  for(const x of imgs){
    const row=document.createElement('article');row.className='item';
    const text=document.createElement('div');const st=document.createElement('strong');st.textContent=x.name;const d=document.createElement('div');d.className='details';d.textContent=`${(x.size/1024).toLocaleString('de-DE',{maximumFractionDigits:1})} KiB · ${x.shared?'öffentlich freigegeben':'privat'}`;text.append(st,d);
    if(x.shared){const im=document.createElement('img');im.src=`https://static.${siteName}/${x.id}`;im.alt=x.name;im.className='thumb';text.append(im);}
    const acts=document.createElement('div');acts.className='actions';
    const b1=document.createElement('button');b1.type='button';b1.className='secondary';b1.textContent=x.shared?'Freigabe zurückziehen':'Freigeben';
    b1.addEventListener('click',async()=>{try{await api('/api/files/'+x.id,{method:'POST',data:{shared:!x.shared}});await loadImages();await loadTiles();say(x.shared?'Freigabe zurückgezogen. Das Bild ist jetzt privat.':'Bild freigegeben. Es kann jetzt im Blog verwendet werden.');}catch(e){say(e.message);}});
    const b2=document.createElement('button');b2.type='button';b2.className='secondary';b2.textContent='Löschen';
    b2.addEventListener('click',async()=>{if(!confirm(`${x.name} löschen?`))return;try{await api('/api/files/'+x.id,{method:'DELETE'});await loadImages();await loadTiles();}catch(e){say(e.message);}});
    acts.append(b1,b2);row.append(text,acts);list.append(row);
  }
}
$('img-upload').addEventListener('submit',e=>{e.preventDefault();(async()=>{try{const file=$('img-file').files[0];if(!file||file.size>4*1024*1024)throw new Error('Bitte ein Bild bis 4 MiB auswählen.');await api('/api/files?name='+encodeURIComponent(file.name),{method:'POST',raw:file});$('img-upload').reset();await loadImages();await loadTiles();say('Bild privat hochgeladen. Zum Verwenden im Blog freigeben.');}catch(err){say(err.message);}})();});
