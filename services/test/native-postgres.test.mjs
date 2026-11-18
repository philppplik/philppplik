import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import test from 'node:test';import assert from 'node:assert/strict';
import EmbeddedPostgres from 'embedded-postgres';import pg from 'pg';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {PostgresStore,schema} from '../src/postgres.mjs';import {createService,passwordVerifier} from '../src/service.mjs';

test('native PostgreSQL concurrent connections, privacy, persistence and rollback',async()=>{
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const dir=mkdtempSync(join(tmpdir(),'native-pg-fixture-'));
  const database=new EmbeddedPostgres({databaseDir:join(dir,'data'),user:'postgres',password:'explicit-local-only-fixture',port,persistent:true,onLog:()=>{},onError:()=>{}});
  let pool,shutdown=false;const unexpected=[];
  const connectPool=()=>{const p=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'explicit-local-only-fixture',database:'postgres',max:10});p.on('error',e=>{if(!(shutdown&&e.code==='57P01'))unexpected.push(e);});return p;};
  try{
    await database.initialise();await database.start();
    pool=connectPool();
    await pool.query(schema);
    const a=new PostgresStore(pool),b=new PostgresStore(pool);
    const sites={'philipp-paulik.de':{enabled:true,verifier:passwordVerifier('local-native-postgres-fixture','local-fixture')}};
    const one=createService({store:a,sites,enabled:true,clickCounting:true}),two=createService({store:b,sites,enabled:true,clickCounting:true});
    let r=await one(new Request('https://db.philipp-paulik.de/api/login',{method:'POST',headers:{origin:'https://db.philipp-paulik.de','content-type':'application/json'},body:JSON.stringify({password:'local-native-postgres-fixture'})}));assert.equal(r.status,200);
    const cookie=r.headers.get('set-cookie').split(';')[0],csrf=(await r.json()).csrf;
    r=await one(new Request('https://db.philipp-paulik.de/api/links',{method:'POST',headers:{origin:'https://db.philipp-paulik.de','content-type':'application/json',cookie,'x-csrf-token':csrf},body:JSON.stringify({target:'https://example.com'})}));const link=await r.json();assert.equal(r.status,201);
    const responses=await Promise.all(Array.from({length:100},(_,i)=>(i%2?one:two)(new Request('https://link.philipp-paulik.de/'+link.id))));assert.ok(responses.every(r=>r.status===302));
    assert.equal(Number((await pool.query('SELECT requests FROM counts')).rows[0].requests),100);
    const worker=`import pg from 'pg';import {PostgresStore} from './src/postgres.mjs';import {createService} from './src/service.mjs';const p=new pg.Pool({host:'127.0.0.1',port:${port},user:'postgres',password:'explicit-local-only-fixture',database:'postgres'});const s=createService({store:new PostgresStore(p),sites:{'philipp-paulik.de':{enabled:true}},enabled:true,clickCounting:true});for(let i=0;i<25;i++){const r=await s(new Request('https://link.philipp-paulik.de/${link.id}'));if(r.status!==302)throw new Error('Redirect failed');}await p.end();`;
    await Promise.all(Array.from({length:4},()=>new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--input-type=module','-e',worker],{cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',d=>error+=d);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(error)));
    })));
    assert.equal(Number((await pool.query('SELECT requests FROM counts')).rows[0].requests),200);

    await assert.rejects(()=>a.transaction(async()=>{await a.run('INSERT INTO files(site,id,name,content) VALUES(?,?,?,?)','philipp-paulik.de','b'.repeat(32),'private.txt',Buffer.from('private'));throw new Error('fixture rollback');}));assert.equal((await pool.query('SELECT * FROM files')).rows.length,0);
    await a.run('INSERT INTO files(site,id,name,content) VALUES(?,?,?,?)','philipp-paulik.de','c'.repeat(32),'private.txt',Buffer.from('private'));
    shutdown=true;await pool.end();pool=null;await database.stop();await database.start();shutdown=false;
    pool=connectPool();
    const after=createService({store:new PostgresStore(pool),sites,enabled:true});
    assert.equal((await after(new Request('https://static.philipp-paulik.de/'+'c'.repeat(32)))).status,404);
    assert.equal((await pool.query('SELECT * FROM files')).rows.length,1);
    assert.deepEqual(unexpected,[]);
  }finally{shutdown=true;if(pool)await pool.end();await database.stop().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});
