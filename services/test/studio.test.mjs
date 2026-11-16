import{test}from'node:test';import assert from'node:assert/strict';import{Store}from'../src/sqlite.mjs';import{createService,passwordVerifier}from'../src/service.mjs';import{createContentService}from'../src/content.mjs';import{readSession}from'../src/sessions.mjs';
test('studio host m: login-gated overview over the same data, ads host routed',async()=>{
 const store=new Store(),site='philipp-paulik.de',password='local-content-fixture-only';
 const content=createContentService({store,site,managementHTML:'<head></head>EDITOR',authenticate:async req=>!!await readSession(req,store,site)});
 const service=createService({store,sites:{[site]:{enabled:true,verifier:passwordVerifier(password)}},enabled:true,modern:true,content,studioHTML:'<html>STUDIO</html>'});
 const cookies={},csrf={};async function request(role,path,{method='GET',data,origin,token=true}={}){const base=`https://${role}.${site}`,headers={origin:origin||base};if(cookies[role])headers.cookie=cookies[role];if(token&&csrf[role])headers['x-csrf-token']=csrf[role];if(data)headers['content-type']='application/json';const r=await service(new Request(base+path,{method,headers,body:data?JSON.stringify(data):undefined}));if(path==='/api/login'&&r.ok){cookies[role]=r.headers.get('set-cookie').split(';')[0];csrf[role]=(await r.clone().json()).csrf;}return r;}
 assert.equal((await request('m','/')).status,200);assert.equal((await request('m','/api/overview')).status,401);
 assert.equal((await request('m','/api/login',{method:'POST',data:{password}})).status,200);
 const o=await request('m','/api/overview');assert.equal(o.status,200);const j=await o.json();assert.equal(j.lp.published,0);assert.equal(j.hosts.ads,'https://ads.'+site+'/');
 assert.equal((await request('ads','/api/content')).status,401);
 assert.equal((await request('m','/api/files')).status,200);
 store.close();
});
test('studio m: newsletter management wired privately, public host off, send gated',async()=>{
 const store=new Store(),site='philipp-paulik.de',password='local-newsletter-fixture-only';
 const {createNewsletter}=await import('../src/newsletter.mjs');
 const content=createContentService({store,site,managementHTML:'<head></head>EDITOR',authenticate:async req=>!!await readSession(req,store,site)});
 const newsletter=createNewsletter({store,site});
 const service=createService({store,sites:{[site]:{enabled:true,verifier:passwordVerifier(password)}},enabled:true,modern:true,content,newsletter,studioHTML:'<html>STUDIO</html>'});
 const cookies={},csrf={};async function request(role,path,{method='GET',data,origin,token=true}={}){const base=`https://${role}.${site}`,headers={origin:origin||base};if(cookies[role])headers.cookie=cookies[role];if(token&&csrf[role])headers['x-csrf-token']=csrf[role];if(data)headers['content-type']='application/json';const r=await service(new Request(base+path,{method,headers,body:data?JSON.stringify(data):undefined}));if(path==='/api/login'&&r.ok){cookies[role]=r.headers.get('set-cookie').split(';')[0];csrf[role]=(await r.clone().json()).csrf;}return r;}
 assert.equal((await request('news','/')).status,404);
 assert.equal((await request('m','/newsletter')).status,401===401?200:200);
 const page=await request('m','/newsletter');assert.match(await page.text(),/content-role" content="news"/);
 assert.equal((await request('m','/api/newsletter/subscribers')).status,401);
 assert.equal((await request('m','/api/login',{method:'POST',data:{password}})).status,200);
 const subs=await request('m','/api/newsletter/subscribers');assert.equal(subs.status,200);assert.equal((await subs.json()).sendEnabled,false);
 const create=await request('m','/api/content',{method:'POST',data:{title:'Erster Newsletter',paragraphs:['Hallo'],custom:{html:'<p>Hallo</p>'}}});assert.equal(create.status,201);const{slug}=await create.json();
 const list=await (await request('m','/api/content')).json();assert.equal(list.role,'news');assert.equal(list.items.length,1);
 assert.equal((await request('m','/preview/'+slug)).status,200);
 const anon=await service(new Request(`https://m.${site}/preview/${slug}`,{headers:{origin:`https://m.${site}`}}));assert.equal(anon.status,401);
 assert.equal((await request('m','/api/newsletter/send',{method:'POST',data:{confirm:'SEND',subject:'x',slug},token:false})).status,403);
 const send=await request('m','/api/newsletter/send',{method:'POST',data:{confirm:'SEND',subject:'x',slug}});assert.equal(send.status,403);assert.match(JSON.stringify(await send.json()),/nicht freigegeben/);
 const ov=await (await request('m','/api/overview')).json();assert.equal(ov.news.drafts,1);
 store.close();
});
