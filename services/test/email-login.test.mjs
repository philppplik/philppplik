import {test} from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../src/sqlite.mjs';import {createService,passwordVerifier} from '../src/service.mjs';
test('login with e-mail verifier needs matching e-mail and password',async()=>{
 const store=new Store(),pw='local-email-fixture-password-1';
 const svc=createService({store,enabled:true,modern:true,sites:{'philipp-paulik.de':{enabled:true,verifier:{...passwordVerifier(pw,'fixture'),email:'Philipp@Example.test'}}}});
 const call=data=>svc(new Request('https://static.philipp-paulik.de/api/login',{method:'POST',headers:{origin:'https://static.philipp-paulik.de','content-type':'application/json'},body:JSON.stringify(data)}));
 assert.equal((await call({password:pw})).status,401);
 assert.equal((await call({email:'other@example.test',password:pw})).status,401);
 assert.equal((await call({email:'philipp@example.test',password:'wrong-wrong-wrong-wrong-1'})).status,401);
 assert.equal((await call({email:' PHILIPP@example.test ',password:pw})).status,200);
 store.close();
});
