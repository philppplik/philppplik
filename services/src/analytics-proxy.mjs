// Keep the existing encrypted GA4 publisher unchanged. Only its fixed public
// ciphertext and assets are read; passwords and decrypted metrics stay in-browser.
const allowed=/^\/(?:index\.html|assets\/[a-zA-Z0-9_.\-/]+|data\/analytics\.json\.enc)$/;
const cache=new Map();
export let unlockEnabled=false;
export function setUnlockEnabled(v){unlockEnabled=!!v;}
export async function analyticsProxy(req){
 const u=new URL(req.url),path=u.pathname==='/'?'/index.html':u.pathname;
 if(unlockEnabled&&path==='/ga-unlock.js'&&['GET','HEAD'].includes(req.method)&&!u.search)return new Response(req.method==='HEAD'?null:(await import('node:fs')).readFileSync((await import('node:path')).join(process.cwd(),'public','ga-unlock.js'),'utf8'),{headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 if(!['GET','HEAD'].includes(req.method)||u.search||!allowed.test(path)||path.includes('..'))return new Response('Not found',{status:404});
 const key=path;let item=cache.get(key);
 if(!item||Date.now()-item.at>300000){
  try{const r=await fetch('https://db.philipp-paulik.de'+path,{redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('upstream');
  let bytes=Buffer.from(await r.arrayBuffer());if(path==='/index.html'){let html=bytes.toString().replace('<nav aria-label="Dashboard">','<nav aria-label="Dashboard"><a href="/manage">Kurzlink-Statistik</a>');if(unlockEnabled)html=html.replace('<script src="assets/dashboard.js"></script>','<script src="assets/dashboard.js"></script><script src="/ga-unlock.js"></script>');bytes=Buffer.from(html);}if(bytes.length>2*1024*1024)throw new Error('size');
  item={at:Date.now(),bytes,type:r.headers.get('content-type')||'application/octet-stream'};cache.set(key,item);
  }catch{return new Response('GA4-Dashboard derzeit nicht erreichbar. Bitte später erneut versuchen.',{status:503,headers:{'cache-control':'no-store'}})}
 }
 return new Response(req.method==='HEAD'?null:item.bytes,{headers:{'content-type':item.type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
}
