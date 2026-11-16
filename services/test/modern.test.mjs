import{test}from'node:test';import assert from'node:assert/strict';import{Store}from'../src/sqlite.mjs';import{createService,passwordVerifier}from'../src/service.mjs';
const password='local-test-fixture-not-a-real-secret';
test('modern hosts keep their UI, files and links isolated; editable short links',async()=>{
 const store=new Store();const svc=createService({store,enabled:true,modern:true,clickCounting:true,sites:{'philipp-paulik.de':{enabled:true,verifier:passwordVerifier(password)}},managementHTML:'TOOLS',analytics:()=>new Response('GA4 encrypted view')});
 const cookies={},tokens={};
 async function req(role,path,method='GET',data){const origin=`https://${role}.philipp-paulik.de`,h={origin};if(cookies[role])h.cookie=cookies[role];if(tokens[role])h['x-csrf-token']=tokens[role];if(data)h['content-type']='application/json';const r=await svc(new Request(origin+path,{method,headers:h,body:data?JSON.stringify(data):undefined}));if(path==='/api/login'&&r.ok){cookies[role]=r.headers.get('set-cookie').split(';')[0];tokens[role]=(await r.clone().json()).csrf;}return r;}
 for(const host of ['static','l']){const r=await req(host,'/');assert.equal(r.status,200);assert.equal(r.headers.get('location'),null);assert.equal(await r.text(),'TOOLS');assert.equal((await req(host,'/api/session')).status,401);assert.equal((await req(host,'/api/login','POST',{password})).status,200);}
 assert.equal(await(await req('analytics','/')).text(),'GA4 encrypted view');
 assert.equal((await req('static','/api/links')).status,404);assert.equal((await req('l','/api/files')).status,404);
 let r=await req('l','/api/links','POST',{target:'https://example.com/start',slug:'my-link',label:'One'});assert.equal(r.status,201);const data=await r.json();assert.equal(data.url,'https://l.philipp-paulik.de/my-link');assert.equal((await req('l','/my-link')).headers.get('location'),'https://example.com/start');
 assert.equal((await req('l','/api/links/my-link','POST',{target:'https://example.org/changed',label:'Changed'})).status,200);assert.equal((await req('l','/my-link')).headers.get('location'),'https://example.org/changed');
 assert.equal((await req('l','/api/links/my-link','DELETE')).status,204);assert.equal((await req('l','/my-link')).status,404);
 assert.equal((await req('l','/api/links','POST',{target:'https://l.philipp-paulik.de/loop'})).status,400);
 store.close();
});
