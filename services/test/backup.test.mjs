import test from 'node:test';import assert from 'node:assert/strict';import {backup} from 'node:sqlite';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {Store} from '../src/sqlite.mjs';import {createService} from '../src/service.mjs';
test('local SQLite online backup and isolated restore preserve private file denial',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'backup-fixture-'));let source,restored;
 try{source=new Store(join(dir,'source.sqlite'));await source.run('INSERT INTO files VALUES(?,?,?,?,?)','philipp-paulik.de','a'.repeat(32),'private-fixture.pdf',Buffer.from('%PDF-1.7\nfixture'),0);await backup(source.db,join(dir,'restored.sqlite'));restored=new Store(join(dir,'restored.sqlite'));assert.equal((await restored.get('SELECT shared FROM files')).shared,0);const service=createService({store:restored,enabled:true,sites:{'philipp-paulik.de':{enabled:true}}});assert.equal((await service(new Request('https://static.philipp-paulik.de/'+'a'.repeat(32)))).status,404);
 }finally{source?.close();restored?.close();rmSync(dir,{recursive:true,force:true});}
});
