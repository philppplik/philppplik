import test from 'node:test';import assert from 'node:assert/strict';import https from 'node:https';
import {execFileSync} from 'node:child_process';import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Store} from '../src/sqlite.mjs';import {passwordVerifier,createService} from '../src/service.mjs';import {createRuntime} from '../src/runtime.mjs';import {maintain} from '../src/maintenance.mjs';

test('real HTTPS runtime, SNI/Host isolation and encrypted GA4 bridge refresh',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'https-runtime-fixture-')),dashboard=join(dir,'dashboard');mkdirSync(join(dashboard,'data'),{recursive:true});mkdirSync(join(dashboard,'assets'),{recursive:true});
  writeFileSync(join(dashboard,'index.html'),'<html>Local encrypted GA4 fixture</html>');writeFileSync(join(dashboard,'data/analytics.json.enc'),JSON.stringify({v:1,salt:'fixture',iv:'fixture',ct:'ciphertext-one'}));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-subj','/CN=local-test.invalid','-days','1'],{stdio:'pipe'});
  const store=new Store();const server=createRuntime({store,sites:{'philipp-paulik.de':{enabled:true,verifier:passwordVerifier('local-runtime-fixture-password','fixture')}},enabled:true,key:readFileSync(join(dir,'key.pem')),cert:readFileSync(join(dir,'cert.pem')),dashboardDirectory:dashboard});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  const call=(path,{host='db.philipp-paulik.de',sni=host,method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
    const req=https.request({hostname:'127.0.0.1',port,path,servername:sni,rejectUnauthorized:false,method,headers:{host,...headers}},res=>{const chunks=[];res.on('data',d=>chunks.push(d));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(body);
  });
  try{
    let r=await call('/');assert.equal(r.status,200);assert.match(r.body,/encrypted GA4 fixture/);
    r=await call('/data/analytics.json.enc');assert.equal(JSON.parse(r.body).ct,'ciphertext-one');assert.equal(r.headers['cache-control'],'no-store');
    writeFileSync(join(dashboard,'data/analytics.json.enc'),JSON.stringify({v:1,ct:'ciphertext-two'}));assert.equal(JSON.parse((await call('/data/analytics.json.enc')).body).ct,'ciphertext-two');
    assert.equal((await call('/manage')).status,200);assert.equal((await call('/manage.js')).status,200);assert.equal((await call('/manage.css')).status,200);
    assert.equal((await call('/api/links')).status,401);assert.equal((await call('/manage',{sni:'wrong.invalid'})).status,421);
    assert.equal((await call('/manage',{headers:{'x-forwarded-host':'db.philipp-paulik.de'}})).status,421);
    assert.equal((await call('/',{host:'analytics.philipp-paulik.de'})).headers.location,'https://db.philipp-paulik.de/');
    const form=JSON.stringify({password:'local-runtime-fixture-password'});
    r=await call('/api/login',{method:'POST',headers:{origin:'https://db.philipp-paulik.de','content-type':'application/json','content-length':Buffer.byteLength(form)},body:form});assert.equal(r.status,200);assert.ok(r.headers['set-cookie'][0].includes('HttpOnly'));
    assert.equal((await call('/data/../../.env')).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('scheduled maintenance removes inactive-link counts and expired sessions',async()=>{
  const store=new Store();const now=Date.parse('2026-11-12T00:00:00Z');
  await store.run('INSERT INTO links VALUES(?,?,?,?,?,?)','philipp-paulik.de','a'.repeat(32),'https://example.com','fixture',0,null);
  await store.run('INSERT INTO counts VALUES(?,?,?,?)','philipp-paulik.de','a'.repeat(32),'2026-01-01',100);
  await store.run('INSERT INTO sessions VALUES(?,?,?,?)','philipp-paulik.de','fixture','fixture',now-1);
  await maintain(store,now);assert.equal((await store.all('SELECT * FROM counts')).length,0);assert.equal((await store.all('SELECT * FROM sessions')).length,0);store.close();
});

test('public per-site/role rate cap returns 429, never stores request identity',async()=>{
  const store=new Store(),sites={'philipp-paulik.de':{enabled:true},'intelligenz-welt.de':{enabled:true}};
  const service=createService({store,sites,enabled:true,publicPerMinute:2});
  for(let i=0;i<2;i++)assert.equal((await service(new Request('https://static.philipp-paulik.de/not-a-file'))).status,404);
  assert.equal((await service(new Request('https://static.philipp-paulik.de/not-a-file'))).status,429);
  assert.equal((await service(new Request('https://static.intelligenz-welt.de/not-a-file'))).status,404);
  assert.equal((await service(new Request('https://link.philipp-paulik.de/not-a-file'))).status,404);
  assert.deepEqual((await store.all('PRAGMA table_info(public_limits)')).map(x=>x.name),['site','role','bucket','requests']);store.close();
});
