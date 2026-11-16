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
 store.close();
});
