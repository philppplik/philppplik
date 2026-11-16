import { PGlite } from '@electric-sql/pglite';
import { PostgresStore,schema } from '../src/postgres.mjs';
import { createService,passwordVerifier } from '../src/service.mjs';
import test from 'node:test';import assert from 'node:assert/strict';

test('Postgres SQL path: private files, session, atomic increments, revoke and isolation',async()=>{
  const pg=new PGlite();
  await pg.exec('CREATE FUNCTION pg_advisory_xact_lock(integer) RETURNS void LANGUAGE SQL AS $$ SELECT $$;');
  await pg.exec(schema);
  const pool={query:(text,args)=>pg.query(text,args),connect:async()=>({query:(text,args)=>pg.query(text,args),release(){}})};
  const store=new PostgresStore(pool),verifier=passwordVerifier('local-postgres-fixture-password','fixture');
  const service=createService({store,enabled:true,clickCounting:true,sites:{'philipp-paulik.de':{enabled:true,verifier},'intelligenz-welt.de':{enabled:true,verifier}}});
  let csrf,cookie;
  const call=async(path,{role='db',method='GET',data,raw,site='philipp-paulik.de'}={})=>{
    const base=`https://${role}.${site}`;const headers={origin:base};if(cookie)headers.cookie=cookie;if(csrf)headers['x-csrf-token']=csrf;if(data)headers['content-type']='application/json';
    return service(new Request(base+path,{method,headers,body:data?JSON.stringify(data):raw}));
  };
  let r=await call('/api/login',{method:'POST',data:{password:'local-postgres-fixture-password'}});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.json()).csrf;
  r=await call('/api/links',{method:'POST',data:{target:'https://example.com',label:'Fixture'}});assert.equal(r.status,201);const link=await r.json();
  for(let i=0;i<12;i++){r=await call('/'+link.id,{role:'link'});assert.equal(r.status,302);}
  let data=await (await call('/api/links')).json();assert.equal(data.daily[0].requests,12);
  r=await call('/api/files?name=fixture.pdf',{method:'POST',raw:Buffer.from('%PDF-fixture')});assert.equal(r.status,201);const f=await r.json();
  assert.equal((await call('/'+f.id,{role:'static'})).status,404);
  assert.equal((await call('/api/files/'+f.id,{method:'POST',data:{shared:true}})).status,200);
  r=await call('/'+f.id,{role:'static'});assert.equal(r.status,200);assert.equal(await r.text(),'%PDF-fixture');
  assert.equal((await call('/'+f.id,{role:'static',site:'intelligenz-welt.de'})).status,404);
  await call('/api/files/'+f.id,{method:'POST',data:{shared:false}});assert.equal((await call('/'+f.id,{role:'static'})).status,404);
  await pg.close();
});
