import https from 'node:https';
import {readFileSync} from 'node:fs';
import {createService} from './service.mjs';
import {dashboardBridge} from './dashboard.mjs';
import {maintain} from './maintenance.mjs';

export function createRuntime({store,sites,enabled=false,clickCounting=false,key,cert,dashboardDirectory,maintenanceInterval=3600000}) {
  const assets={};
  for(const [file,type] of [['manage.css','text/css'],['manage.js','text/javascript']])assets['/'+file]={body:readFileSync(new URL('../public/'+file,import.meta.url),'utf8'),type};
  const service=createService({store,sites,enabled,clickCounting,managementHTML:readFileSync(new URL('../public/manage.html',import.meta.url),'utf8'),managementAssets:assets,dashboard:dashboardDirectory?dashboardBridge(dashboardDirectory):null});
  const server=https.createServer({key,cert,minVersion:'TLSv1.2',maxHeaderSize:16384,requestTimeout:15000,headersTimeout:10000},async(req,res)=>{
    try {
      const host=req.headers.host||'';
      // Exact SNI/Host match. Reverse proxies need their own separately tested
      // trusted-ingress adapter, not an arbitrary forwarded-host exception.
      if(!/^[a-z0-9.-]+$/.test(host) || req.socket.servername!==host || req.headers['x-forwarded-host']){
        res.writeHead(421,{'cache-control':'no-store'});return res.end('Misdirected request');
      }
      const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):value);
      const request=new Request('https://'+host+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:req,duplex:'half'});
      const result=await service(request);
      res.writeHead(result.status,Object.fromEntries(result.headers));
      if(result.body)res.end(Buffer.from(await result.arrayBuffer()));else res.end();
    }catch{res.writeHead(503,{'cache-control':'no-store'});res.end('Service unavailable');}
  });
  server.maintenanceStatus={lastSuccess:null,failed:false};
  const timer=setInterval(async()=>{try{await maintain(store);server.maintenanceStatus={lastSuccess:Date.now(),failed:false};}catch{server.maintenanceStatus={...server.maintenanceStatus,failed:true};}},maintenanceInterval);timer.unref();
  server.on('close',()=>clearInterval(timer));
  return server;
}
