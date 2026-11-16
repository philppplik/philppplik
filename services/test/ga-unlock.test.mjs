import {test} from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../src/sqlite.mjs';import {createService,passwordVerifier} from '../src/service.mjs';import {createGaData} from '../src/ga-data.mjs';
const pw='ga-fixture-password-not-real',enc=async obj=>{
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt']);
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(obj)));
  const b=x=>Buffer.from(x).toString('base64');return JSON.stringify({v:1,salt:b(salt),iv:b(iv),ct:b(ct)});
};
test('GA4 data opens only for a signed-in session and only with the right key',async()=>{
  const body=await enc({daily:[{date:'20261116',users:3}]});
  let calls=0;const fetchImpl=async()=>{calls++;return new Response(body)};
  const store=new Store(),password='local-ga-session-fixture';
  const gaData=createGaData({password:pw,fetchImpl});
  const svc=createService({store,enabled:true,modern:true,sites:{'philipp-paulik.de':{enabled:true,verifier:{...passwordVerifier(password,'fx'),email:'a@example.test'}}},analytics:()=>new Response('X'),gaData});
  const o='https://analytics.philipp-paulik.de';
  assert.equal((await svc(new Request(o+'/api/ga'))).status,401);
  const l=await svc(new Request(o+'/api/login',{method:'POST',headers:{origin:o,'content-type':'application/json'},body:JSON.stringify({email:'a@example.test',password})}));
  assert.equal(l.status,200);const cookie=l.headers.get('set-cookie').split(';')[0];
  const r=await svc(new Request(o+'/api/ga',{headers:{cookie}}));assert.equal(r.status,200);assert.equal((await r.json()).daily[0].users,3);
  await svc(new Request(o+'/api/ga',{headers:{cookie}}));assert.equal(calls,1);
  const bad=createGaData({password:'wrong',fetchImpl});await assert.rejects(bad());
  assert.equal(createGaData({password:''}),null);
  store.close();
});
