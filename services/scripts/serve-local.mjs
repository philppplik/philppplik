import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
import {Store} from '../src/sqlite.mjs';import {PostgresStore} from '../src/postgres.mjs';import {createRuntime} from '../src/runtime.mjs';import {maintain} from '../src/maintenance.mjs';

// This command binds loopback only. It is not an automated deployment tool.
// TLS, credential verifier and database paths must be supplied explicitly.
const required=['SERVICE_CONFIG','TLS_KEY_FILE','TLS_CERT_FILE'];for(const k of required)if(!process.env[k])throw new Error('Missing '+k);
const sites=JSON.parse(readFileSync(resolve(process.env.SERVICE_CONFIG),'utf8'));
let store,pool;
if(process.env.DATABASE_URL){const pg=await import('pg');pool=new pg.default.Pool({connectionString:process.env.DATABASE_URL,max:8});store=new PostgresStore(pool);}
else{if(!process.env.SQLITE_FILE)throw new Error('Set SQLITE_FILE or DATABASE_URL');store=new Store(resolve(process.env.SQLITE_FILE));}
await maintain(store);
const server=createRuntime({store,sites,enabled:process.env.SERVICES_ENABLED==='1',clickCounting:process.env.CLICK_COUNTING_ENABLED==='1',key:readFileSync(process.env.TLS_KEY_FILE),cert:readFileSync(process.env.TLS_CERT_FILE),dashboardDirectory:process.env.DASHBOARD_DIRECTORY});
const port=Number(process.env.PORT||8443);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use a loopback development port 1024-65535');
server.listen(port,'127.0.0.1',()=>console.log('Local TLS listener ready on loopback. Feature gates are controlled explicitly. No deployment performed.'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{if(pool)await pool.end();else store.close();process.exit(0);}));
