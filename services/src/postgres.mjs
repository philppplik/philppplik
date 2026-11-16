import { AsyncLocalStorage } from 'node:async_hooks';

// A pg-compatible pool is injected. No credentials, provider account, database or
// paid resource is created merely by importing this module.
export class PostgresStore {
  constructor(pool) {this.pool=pool;this.context=new AsyncLocalStorage();}
  sql(text) {
    let n=0;
    return text.replace(/\?/g,()=>`$${++n}`).replace(/length\(content\)/g,'octet_length(content)');
  }
  async query(text,args) {return (this.context.getStore()||this.pool).query(this.sql(text),args);}
  async run(text,...args) {const r=await this.query(text,args);return {changes:r.rowCount??r.affectedRows??0};}
  normalize(row) {
    if(!row)return row;
    return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,['expires','used','size','requests','attempts'].includes(k)&&v!==null?Number(v):v]));
  }
  async get(text,...args) {return this.normalize((await this.query(text,args)).rows[0]);}
  async all(text,...args) {return (await this.query(text,args)).rows.map(r=>this.normalize(r));}
  async transaction(fn) {
    if(this.context.getStore())return fn();
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serializes the short multi-step invariants (counter plus active check,
      // login cap and upload quota) across every process sharing this database.
      // No network/file request is performed inside these transactions.
      await client.query('SELECT pg_advisory_xact_lock(187634021)');
      const result=await this.context.run(client,fn);
      await client.query('COMMIT');return result;
    } catch(e){await client.query('ROLLBACK');throw e;}
    finally{client.release();}
  }
}
export const schema=`
CREATE TABLE IF NOT EXISTS links(site TEXT, id TEXT, target TEXT NOT NULL, label TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, expires BIGINT, PRIMARY KEY(site,id));
CREATE TABLE IF NOT EXISTS counts(site TEXT, id TEXT, day TEXT, requests BIGINT NOT NULL, PRIMARY KEY(site,id,day), FOREIGN KEY(site,id) REFERENCES links(site,id));
CREATE TABLE IF NOT EXISTS files(site TEXT, id TEXT, name TEXT NOT NULL, content BYTEA NOT NULL, shared INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(site,id));
CREATE TABLE IF NOT EXISTS sessions(site TEXT, digest TEXT, csrf TEXT NOT NULL, expires BIGINT NOT NULL, PRIMARY KEY(site,digest));
CREATE TABLE IF NOT EXISTS public_limits(site TEXT, role TEXT, bucket BIGINT, requests INTEGER NOT NULL, PRIMARY KEY(site,role,bucket));
CREATE TABLE IF NOT EXISTS login_limits(site TEXT, bucket BIGINT, attempts INTEGER NOT NULL, PRIMARY KEY(site,bucket));
`;
