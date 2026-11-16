import{test}from'node:test';import assert from'node:assert/strict';import{Store}from'../src/sqlite.mjs';import{createService,passwordVerifier}from'../src/service.mjs';import{createContentService}from'../src/content.mjs';import{readSession}from'../src/sessions.mjs';
test('central router protects content list/create/edit/status and draft previews',async()=>{
 const store=new Store(),site='philipp-paulik.de',password='local-content-fixture-only';
 const content=createContentService({store,site,managementHTML:'<head></head>EDITOR',authenticate:async req=>!!await readSession(req,store,site)});
 const service=createService({store,sites:{[site]:{enabled:true,verifier:passwordVerifier(password)}},enabled:true,modern:true,content});
 const cookies={},csrf={};async function request(role,path,{method='GET',data,origin,token=true}={}){const base=`https://${role}.${site}`,headers={origin:origin||base};if(cookies[role])headers.cookie=cookies[role];if(token&&csrf[role])headers['x-csrf-token']=csrf[role];if(data)headers['content-type']='application/json';const r=await service(new Request(base+path,{method,headers,body:data?JSON.stringify(data):undefined}));if(path==='/api/login'&&r.ok){cookies[role]=r.headers.get('set-cookie').split(';')[0];csrf[role]=(await r.clone().json()).csrf;}return r;}
 for(const role of ['blog','lp']){
  assert.equal((await request(role,'/api/content')).status,401);assert.equal((await request(role,'/api/content',{method:'POST',data:{title:'Private',paragraphs:['Private']}})).status,401);assert.equal((await request(role,'/preview/private')).status,401);
  const shell=await request(role,role==='blog'?'/manage':'/');assert.equal(shell.status,200);assert.match(await shell.text(),new RegExp('content="'+role+'"'));
  assert.equal((await request(role,'/api/login',{method:'POST',data:{password}})).status,200);
  assert.equal((await request(role,'/api/content',{method:'POST',data:{title:'Private',paragraphs:['Private']},token:false})).status,403);
  assert.equal((await request(role,'/api/content',{method:'POST',data:{title:'Private',paragraphs:['Private']},origin:'https://evil.example'})).status,403);
  assert.equal((await request(role,'/api/content',{method:'POST',data:{title:'Private',paragraphs:['Private']}})).status,201);
  assert.equal((await request(role,'/private')).status,404);assert.equal((await request(role,'/preview/private')).status,200);
  assert.equal((await request(role,'/api/content/private/status',{method:'POST',data:{status:'published'},token:false})).status,403);
  assert.equal((await request(role,'/api/content/private/status',{method:'POST',data:{status:'published'}})).status,200);assert.equal((await request(role,'/private')).status,200);
  assert.equal((await request(role,'/api/content/private',{method:'DELETE'})).status,204);
 }
 store.close();
});
