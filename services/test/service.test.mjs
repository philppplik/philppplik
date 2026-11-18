import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/sqlite.mjs';
import { createService,passwordVerifier } from '../src/service.mjs';

const password='local-test-fixture-not-a-real-secret';
const verifier=passwordVerifier(password,'local-fixture');
function setup(options={}) {
  const store=new Store();let time=Date.parse('2026-11-12T17:00:00Z');
  const sites={'philipp-paulik.de':{enabled:true,verifier},'intelligenz-welt.de':{enabled:true,verifier},'finanz-adjust.de':{enabled:false,verifier},'kifachblatt.de':{enabled:false,verifier}};
  const service=createService({store,sites,enabled:true,clickCounting:true,now:()=>time,...options});
  let cookie='',csrf='';
  async function req(path,opts={}) {
    const {site='philipp-paulik.de',role='db',method='GET',data,raw,headers={}}=opts;
    const base=`https://${role}.${site}`;
    const h={...headers};
    if(cookie)h.cookie=cookie;if(csrf)h['x-csrf-token']=csrf;
    if(method!=='GET' && method!=='HEAD')h.origin=base;
    if(data!==undefined)h['content-type']='application/json';
    const r=await service(new Request(base+path,{method,headers:h,body:data!==undefined?JSON.stringify(data):raw}));
    if(path==='/api/login' && r.status===200){cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.clone().json()).csrf;}
    return r;
  }
  return {store,service,req,login:()=>req('/api/login',{method:'POST',data:{password}}),advance:n=>time+=n};
}

test('default-off, tenant allowlist and host isolation',async()=>{
  const x=setup({enabled:false});assert.equal((await x.req('/api/login',{method:'POST',data:{password}})).status,404);x.store.close();
  const y=setup();
  assert.equal((await y.req('/',{role:'static',site:'unknown.de'})).status,404);
  assert.equal((await y.req('/',{site:'finanz-adjust.de'})).status,404);
  assert.equal((await y.req('/api/session',{headers:{'x-forwarded-host':'db.philipp-paulik.de'}})).status,404);
  assert.equal((await y.service(new Request('http://db.philipp-paulik.de/manage'))).status,404);
  y.store.close();
});
test('auth cookie is secure, host-only, HttpOnly; logout and expiry',async()=>{
  const x=setup();assert.equal((await x.req('/api/links')).status,401);
  const r=await x.login();assert.equal(r.status,200);const c=r.headers.get('set-cookie');
  for(const part of ['__Host-console=','HttpOnly','Secure','SameSite=Strict','Path=/'])assert.ok(c.includes(part));assert.ok(!c.includes('Domain='));
  assert.equal((await x.req('/api/session')).status,200);
  assert.equal((await x.req('/api/session',{site:'intelligenz-welt.de'})).status,401);
  assert.equal((await x.req('/api/logout',{method:'POST'})).status,204);
  assert.equal((await x.req('/api/session')).status,401);
  await x.login();x.advance(3600001);assert.equal((await x.req('/api/session')).status,401);x.store.close();
});
test('no CSRF or cross-origin mutations; login attempt cap',async()=>{
  const x=setup();await x.login();
  let r=await x.service(new Request('https://db.philipp-paulik.de/api/links',{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json'},body:'{}'}));assert.equal(r.status,401);
  const c=(await x.login()).headers.get('set-cookie').split(';')[0];
  r=await x.service(new Request('https://db.philipp-paulik.de/api/links',{method:'POST',headers:{cookie:c,origin:'https://evil.invalid','content-type':'application/json'},body:'{}'}));assert.equal(r.status,403);
  r=await x.service(new Request('https://db.philipp-paulik.de/api/links',{method:'POST',headers:{cookie:c,origin:'https://db.philipp-paulik.de','content-type':'application/json'},body:'{}'}));assert.equal(r.status,403);
  for(let i=0;i<12;i++)r=await x.req('/api/login',{method:'POST',data:{password:'wrong'}});assert.equal(r.status,429);x.store.close();
});
test('random HEX links, immutable targets, disable, expiry, counts',async()=>{
  const x=setup();await x.login();
  const created=await (await x.req('/api/links',{method:'POST',data:{target:'https://example.com/one?campaign=foo',label:'Example'}})).json();
  assert.match(created.id,/^[a-f0-9]{32}$/);
  let r=await x.req('/'+created.id,{role:'link'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'https://example.com/one?campaign=foo');assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('cache-control'),'no-store, max-age=0');
  for(const opts of [{method:'HEAD'},{headers:{purpose:'prefetch'}},{headers:{'user-agent':'WhatsApp bot'}}])assert.equal((await x.req('/'+created.id,{role:'link',...opts})).status,302);
  assert.equal((await (await x.req('/api/links')).json()).daily[0].requests,1);
  assert.equal((await x.req('/'+created.id+'?url=https://evil.invalid',{role:'link'})).status,404);
  assert.equal((await x.req('/'+created.id,{role:'link',site:'intelligenz-welt.de'})).status,404);
  await x.req('/api/links/'+created.id,{method:'POST',data:{active:false}});assert.equal((await x.req('/'+created.id,{role:'link'})).status,404);
  const exp=await (await x.req('/api/links',{method:'POST',data:{target:'https://example.com',expires:Date.parse('2026-11-12T17:00:01Z')}})).json();x.advance(1001);assert.equal((await x.req('/'+exp.id,{role:'link'})).status,404);x.store.close();
});
test('reject dangerous destinations and invalid JSON without persistence',async()=>{
  const x=setup();await x.login();
  for(const target of ['javascript:alert(1)','http://example.com','https://localhost','https://127.0.0.1','https://[::1]','https://user:password@example.com','https://example.com:8443','https://link.philipp-paulik.de/abc','https://foo.internal','https://example.com/\nfoo'])assert.equal((await x.req('/api/links',{method:'POST',data:{target}})).status,400,target);
  assert.equal((await x.req('/api/links',{method:'POST',raw:'{',headers:{'content-type':'application/json'}})).status,400);
  assert.equal((await x.req('/api/links',{method:'POST',raw:'x'.repeat(9000),headers:{'content-type':'application/json'}})).status,413);
  assert.equal((await (await x.req('/api/links')).json()).links.length,0);x.store.close();
});
test('files private by default, share/revoke immediate, attachment-only, delete',async()=>{
  const x=setup();await x.login();
  const f=await (await x.req('/api/files?name=report.pdf',{method:'POST',raw:Buffer.from('%PDF-1.7\nlocal fixture\n%%EOF')})).json();
  assert.equal(f.shared,false);assert.equal((await x.req('/'+f.id,{role:'static'})).status,404);
  assert.equal((await x.req('/api/files/'+f.id,{method:'POST',data:{shared:true}})).status,200);
  let r=await x.req('/'+f.id,{role:'static'});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.ok(r.headers.get('content-disposition').startsWith('attachment;'));assert.match(r.headers.get('content-security-policy'),/sandbox/);
  assert.equal((await x.req('/'+f.id,{role:'static',site:'intelligenz-welt.de'})).status,404);
  assert.equal((await x.req('/'+f.id,{role:'static',method:'POST',raw:'x'})).status,405);
  assert.equal((await x.req('/'+f.id,{role:'static',method:'HEAD'})).status,200);
  await x.req('/api/files/'+f.id,{method:'POST',data:{shared:false}});assert.equal((await x.req('/'+f.id,{role:'static'})).status,404);
  assert.equal((await x.req('/api/files/'+f.id,{method:'DELETE'})).status,204);assert.equal((await (await x.req('/api/files')).json()).files.length,0);x.store.close();
});
test('format, path and size validation; no client-controlled file URL',async()=>{
  const x=setup();await x.login();
  for(const [name,raw,status] of [['evil.html','<script>x</script>',400],['../report.pdf','%PDF-1.7',400],['fake.pdf','hello',400],['readme.txt','hello',201],['table.csv','foo,bar',201],['empty.txt','',413],['large.txt','x'.repeat(4*1024*1024+1),413],['null.txt','abc\0',400],['vector.svg','<svg/>',400]])assert.equal((await x.req('/api/files?name='+encodeURIComponent(name),{method:'POST',raw})).status,status,name);
  x.store.close();
});
test('aggregate schema stores no IP, user agent, referrer or identity; retention',async()=>{
  const x=setup();await x.login();const f=await (await x.req('/api/links',{method:'POST',data:{target:'https://example.com'}})).json();
  await x.req('/'+f.id,{role:'link',headers:{'user-agent':'Visitor','x-real-ip':'127.0.0.1',referer:'https://private.example.com/secret'}});
  const columns=(await x.store.all('PRAGMA table_info(counts)')).map(r=>r.name);assert.deepEqual(columns,['site','id','day','requests']);
  x.advance(91*86400000);await x.req('/'+f.id,{role:'link'});assert.equal((await x.store.all('SELECT * FROM counts')).length,1);x.store.close();
});
test('counting separately opt-in; analytics alias fixed to existing dashboard',async()=>{
  const x=setup({clickCounting:false});await x.login();const f=await (await x.req('/api/links',{method:'POST',data:{target:'https://example.com'}})).json();await x.req('/'+f.id,{role:'link'});assert.equal((await x.store.all('SELECT * FROM counts')).length,0);
  const r=await x.req('/',{role:'analytics'});assert.equal(r.headers.get('location'),'https://db.philipp-paulik.de/');assert.equal((await x.req('/?target=https://evil.invalid',{role:'analytics'})).status,404);x.store.close();
});

test('concurrent redirects do not lose increments',async()=>{
  const x=setup();await x.login();const f=await (await x.req('/api/links',{method:'POST',data:{target:'https://example.com'}})).json();
  const results=await Promise.all(Array.from({length:100},()=>x.req('/'+f.id,{role:'link'})));assert.ok(results.every(r=>r.status===302));
  assert.equal((await (await x.req('/api/links')).json()).daily[0].requests,100);x.store.close();
});
test('site upload quota is atomic and enforced',async()=>{
  const x=setup();await x.login();
  const bytes=Buffer.alloc(4*1024*1024,97);
  for(let i=0;i<25;i++)assert.equal((await x.req('/api/files?name=fixture.txt',{method:'POST',raw:bytes})).status,201);
  assert.equal((await x.req('/api/files?name=over.txt',{method:'POST',raw:'x'})).status,413);x.store.close();
});

test('raster images decoded, metadata stripped and served as PNG; fake rasters denied',async()=>{
  const sharp=(await import('sharp')).default;const x=setup();await x.login();
  const raw=await sharp({create:{width:10,height:10,channels:3,background:'#77aaff'}}).jpeg().withMetadata({exif:{IFD0:{Artist:'fixture metadata'}}}).toBuffer();
  const r=await x.req('/api/files?name=photo.jpg',{method:'POST',raw});assert.equal(r.status,201);const f=await r.json();assert.equal(f.name,'photo.png');
  await x.req('/api/files/'+f.id,{method:'POST',data:{shared:true}});
  const shared=await x.req('/'+f.id,{role:'static'});assert.equal(shared.headers.get('content-type'),'image/png');assert.ok(shared.headers.get('content-disposition').startsWith('inline;'));
  const metadata=await sharp(Buffer.from(await shared.arrayBuffer())).metadata();assert.equal(metadata.format,'png');assert.equal(metadata.exif,undefined);assert.equal(metadata.width,10);
  assert.equal((await x.req('/api/files?name=fake.png',{method:'POST',raw:Buffer.from([137,80,78,71,13,10,26,10,1])})).status,400);x.store.close();
});

test('persistent file restart preserves private flag without public access',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=mkdtempSync(join(tmpdir(),'services-fixture-'));const path=join(dir,'data.sqlite');
  let store=new Store(path);await store.run('INSERT INTO files(site,id,name,content) VALUES(?,?,?,?)','philipp-paulik.de','a'.repeat(32),'example.txt',Buffer.from('private fixture'));store.close();
  store=new Store(path);const service=createService({store,enabled:true,sites:{'philipp-paulik.de':{enabled:true}}});
  assert.equal((await service(new Request('https://static.philipp-paulik.de/'+'a'.repeat(32)))).status,404);assert.equal((await store.get('SELECT name FROM files WHERE site=?','philipp-paulik.de')).name,'example.txt');store.close();rmSync(dir,{recursive:true});
});
