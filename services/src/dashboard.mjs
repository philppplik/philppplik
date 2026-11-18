import {readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';

// The caller supplies a local export of the existing public GA4 dashboard repo.
// No password or decrypted analytics is read or copied here. This boundary does
// not change the existing snapshot producer, cryptography or browser-only gate.
export function dashboardBridge(directory) {
  const root=resolve(directory);
  return req=>{
    const u=new URL(req.url);
    if(!['GET','HEAD'].includes(req.method))return null;
    const p=u.pathname==='/'?'/index.html':u.pathname;
    if(!/^\/(?:index\.html|assets\/[a-zA-Z0-9_.\-/]+|data\/analytics\.json\.enc)$/.test(p))return null;
    const file=resolve(root,'.'+p);
    if(!file.startsWith(root+sep))return null;
    let bytes;try{bytes=readFileSync(file);}catch{return new Response('Dashboard asset unavailable',{status:503,headers:{'cache-control':'no-store'}});}
    const ext=p.split('.').at(-1),type={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css',svg:'image/svg+xml',woff2:'font/woff2',enc:'application/json'}[ext]||'application/octet-stream';
    return new Response(req.method==='HEAD'?null:bytes,{headers:{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
  };
}
