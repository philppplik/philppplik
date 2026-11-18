import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
export class Store {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);this.context=new AsyncLocalStorage();this.queue=Promise.resolve();
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS links(site TEXT, id TEXT, target TEXT NOT NULL, label TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, expires INTEGER, PRIMARY KEY(site,id));
      CREATE TABLE IF NOT EXISTS counts(site TEXT, id TEXT, day TEXT, requests INTEGER NOT NULL, PRIMARY KEY(site,id,day), FOREIGN KEY(site,id) REFERENCES links(site,id));
      CREATE TABLE IF NOT EXISTS files(site TEXT, id TEXT, name TEXT NOT NULL, content BLOB NOT NULL, shared INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(site,id));
      CREATE TABLE IF NOT EXISTS sessions(site TEXT, digest TEXT, csrf TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(site,digest));
      CREATE TABLE IF NOT EXISTS public_limits(site TEXT, role TEXT, bucket INTEGER, requests INTEGER NOT NULL, PRIMARY KEY(site,role,bucket));
      CREATE TABLE IF NOT EXISTS login_limits(site TEXT, bucket INTEGER, attempts INTEGER NOT NULL, PRIMARY KEY(site,bucket));`);
  }
  async exclusive(fn) {
    if(this.context.getStore()) return fn();
    const prior=this.queue;let release;this.queue=new Promise(r=>release=r);await prior;
    try{return await this.context.run(true,fn);}finally{release();}
  }
  run(sql,...args) { return this.exclusive(()=>this.db.prepare(sql).run(...args)); }
  get(sql,...args) { return this.exclusive(()=>this.db.prepare(sql).get(...args)); }
  all(sql,...args) { return this.exclusive(()=>this.db.prepare(sql).all(...args)); }
  transaction(fn) {return this.exclusive(async()=>{
    this.db.exec('BEGIN IMMEDIATE');
    try { const value=await fn(); this.db.exec('COMMIT'); return value; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  });}
  close() { this.db.close(); }
}
