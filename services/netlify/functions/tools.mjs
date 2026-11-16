import {readSession} from '../../src/sessions.mjs';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import pg from 'pg';
import {PostgresStore} from '../../src/postgres.mjs';
import {createService} from '../../src/service.mjs';
import {analyticsProxy,setUnlockEnabled} from '../../src/analytics-proxy.mjs';
import {createGaData} from '../../src/ga-data.mjs';
import {createContentService} from '../../src/content.mjs';
import {createNewsletter} from '../../src/newsletter.mjs';
import {maintain} from '../../src/maintenance.mjs';
let service,lastMaintenance=0,store;
async function initialize(){
 if(service)return service;
 const url=process.env.DATABASE_URL,verifier=process.env.TOOLS_VERIFIER;
 if(!url||!verifier)throw new Error('Missing server configuration');
 const pool=new pg.Pool({connectionString:url,max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
 pool.on('error',()=>console.warn('Database idle connection dropped; reconnecting on next request.'));
 store=new PostgresStore(pool);const assets={},contentAssets={};
 for(const [name,type]of [['content.css','text/css'],['content.js','text/javascript'],['richtext.js','text/javascript']])contentAssets['/'+name]={body:readFileSync(join(process.cwd(),'public',name),'utf8'),type};
 const content=createContentService({store,site:'philipp-paulik.de',authenticate:async req=>!!await readSession(req,store,'philipp-paulik.de'),managementHTML:readFileSync(join(process.cwd(),'public/content.html'),'utf8'),managementAssets:contentAssets,vendorDir:join(process.cwd(),'public','vendor')});
 for(const [name,type]of [['manage.css','text/css'],['manage.js','text/javascript'],['studio.js','text/javascript']])assets['/'+name]={body:readFileSync(join(process.cwd(),'public',name),'utf8'),type};
 const gaData=createGaData({password:process.env.GA_DASHBOARD_PASSWORD});setUnlockEnabled(!!gaData);
 // Newsletter management wired for the private studio: no mailer, no send flag, public host off.
 const newsletter=createNewsletter({store,site:'philipp-paulik.de'});
 service=createService({store,enabled:true,modern:true,clickCounting:true,sites:{'philipp-paulik.de':{enabled:true,verifier:JSON.parse(verifier)}},studioHTML:readFileSync(join(process.cwd(),'public/studio.html'),'utf8'),managementHTML:readFileSync(join(process.cwd(),'public/manage.html'),'utf8'),managementAssets:assets,analytics:analyticsProxy,gaData,content,newsletter,newsletterPublic:false});
 return service;
}
export default async function(req){
 try{
  const u=new URL(req.url);
  if(!['analytics','static','l','blog','lp','ads','m'].some(r=>u.hostname===r+'.philipp-paulik.de'))return new Response('Not found',{status:404});
  // The platform-supplied request URL, never client forwarded headers, selects the host.
  const headers=new Headers(req.headers);headers.delete('x-forwarded-host');
  const request=new Request(req,{headers});
  const handler=await initialize();
  if(u.pathname.startsWith('/api/') && Date.now()-lastMaintenance>3600000){lastMaintenance=Date.now();await maintain(store);}
  return await handler(request);
 }catch{return new Response('Dienst vorübergehend nicht erreichbar. Bitte später erneut versuchen.',{status:503,headers:{'cache-control':'no-store'}})}
}
export const config={path:'/*'};
