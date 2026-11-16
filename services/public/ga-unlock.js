// Same sign-in as the other tools: e-mail + password, then the dashboard opens (data is opened server-side for the session).
(function(){
  const old=document.getElementById('gate');if(!old||location.protocol!=='https:')return;
  const gate=old.cloneNode(true);old.replaceWith(gate);
  const pw=gate.querySelector('#pw'),label=gate.querySelector('label[for="pw"]'),note=gate.querySelector('.form-note'),sec=gate.querySelector('.security-note');
  const mail=document.createElement('input');mail.id='em';mail.type='email';mail.required=true;mail.maxLength=320;mail.autocomplete='username';mail.placeholder='Deine E-Mail';
  const ml=document.createElement('label');ml.htmlFor='em';ml.textContent='E-Mail';
  label.before(ml,mail);label.textContent='Passwort';pw.placeholder='Dein Passwort';
  if(note)note.textContent='Melde dich mit demselben Login an wie bei deinen anderen Tools.';
  if(sec)sec.lastChild.textContent=' Passwort und Daten bleiben privat, nur du kommst hier rein.';
  const err=document.getElementById('err'),btn=document.getElementById('unlock');
  async function show(){
    const r=await fetch('/api/ga',{cache:'no-store',credentials:'same-origin'});
    if(!r.ok)throw new Error('data');
    render(await r.json());
    document.getElementById('access').hidden=true;document.getElementById('dash').hidden=false;lock.hidden=false;drawChart(selectedMetric);
  }
  gate.addEventListener('submit',async e=>{
    e.preventDefault();err.textContent='';btn.disabled=true;
    try{
      const email=mail.value,password=pw.value;pw.value='';
      const r=await fetch('/api/login',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
      if(!r.ok)throw new Error(r.status===429?'limit':'login');
      await show();
    }catch(x){err.textContent=x.message==='limit'?'Zu viele Versuche. Bitte später erneut versuchen.':x.message==='data'?'Angemeldet, aber die Daten sind gerade nicht verfügbar.':'E-Mail oder Passwort falsch.';}
    finally{btn.disabled=false;}
  });
  const lockBtn=document.getElementById('lock'),lock=lockBtn.cloneNode(true);lockBtn.replaceWith(lock);
  lock.addEventListener('click',()=>{fetch('/api/session',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(s=>s&&fetch('/api/logout',{method:'POST',credentials:'same-origin',headers:{'x-csrf-token':s.csrf}})).finally(()=>location.reload());});
  fetch('/api/session',{credentials:'same-origin'}).then(r=>r.ok?show():null).catch(()=>{});
})();
