import {readSession} from './sessions.mjs';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import sharp from 'sharp';

const hex = () => randomBytes(16).toString('hex');
const digest = value => createHash('sha256').update(value).digest('hex');
const ID = /^[a-f0-9]{32}$/;
const LINK_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/;
const MAX_FILE = 4 * 1024 * 1024;
const SESSION_MS = 60 * 60 * 1000;
const SECURE_HEADERS = {
  'cache-control':'no-store, max-age=0', 'cdn-cache-control':'no-store',
  'netlify-cdn-cache-control':'no-store', 'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer', 'x-robots-tag':'noindex, nofollow',
  'content-security-policy':"default-src 'none'; frame-ancestors 'none'; sandbox",
};
class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }
const fail = (status,msg) => { throw new HttpError(status,msg); };
const response = (status,body='',extra={}) => new Response(body,{status,headers:{...SECURE_HEADERS,...extra}});
const json = (body,status=200) => response(status,JSON.stringify(body),{'content-type':'application/json; charset=utf-8'});

export function passwordVerifier(password, salt=randomBytes(16).toString('hex')) {
  if (password.length < 20) throw new Error('At least 20 characters required');
  return {salt, hash:scryptSync(password,salt,64).toString('hex')};
}
function validPassword(password, verifier, email) {
  if(typeof password !== 'string' || password.length > 512 || !verifier) return false;
  const actual=scryptSync(password,verifier.salt,64), expected=Buffer.from(verifier.hash,'hex');
  const passwordOk=actual.length === expected.length && timingSafeEqual(actual,expected);
  // Optional second factor of identity: when the verifier carries an e-mail, it must match too (checked after the scrypt work, constant-time on digests).
  if(!verifier.email) return passwordOk;
  const given=createHash('sha256').update(typeof email==='string'&&email.length<=320?email.trim().toLowerCase():'').digest();
  const wanted=createHash('sha256').update(String(verifier.email).trim().toLowerCase()).digest();
  return timingSafeEqual(given,wanted) && passwordOk;
}
export function validTarget(raw, domains) {
  if(typeof raw!=='string' || raw.length>2048 || /[\x00-\x20\x7f]/.test(raw)) fail(400,'Invalid destination');
  let u; try {u=new URL(raw);} catch {fail(400,'Invalid destination');}
  const h=u.hostname.toLowerCase();
  if(u.protocol!=='https:' || u.username || u.password || (u.port && u.port!=='443') ||
    isIP(h.replace(/^\[|\]$/g,'')) || !h.includes('.') || h.endsWith('.') ||
    ['localhost','local','internal','test','invalid'].some(t=>h===t || h.endsWith('.'+t)) ||
    domains.some(d=>h===`l.${d}` || h===`link.${d}` || h===`static.${d}` || h===`db.${d}` || h===`analytics.${d}`)) fail(400,'Invalid destination');
  return u.href;
}
async function validateFile(name,bytes) {
  if(typeof name!=='string' || !name || name.length>160 || /[\x00-\x1f\x7f/\\]/.test(name)) fail(400,'Invalid filename');
  if(!bytes.length || bytes.length>MAX_FILE) fail(413,'File must be 1 byte to 4 MiB');
  const ext=name.split('.').at(-1).toLowerCase();
  const signatures={pdf:Buffer.from('%PDF-'),png:Buffer.from([137,80,78,71,13,10,26,10]),jpg:Buffer.from([255,216,255]),jpeg:Buffer.from([255,216,255]),zip:Buffer.from([80,75])};
  if(ext==='webp') {if(bytes.subarray(0,4).toString()!=='RIFF' || bytes.subarray(8,12).toString()!=='WEBP') fail(400,'Invalid WebP');}
  else if(ext==='txt' || ext==='csv') {try {new TextDecoder('utf-8',{fatal:true}).decode(bytes);} catch {fail(400,'UTF-8 text required');} if(bytes.includes(0)) fail(400,'Invalid text');}
  else if(!signatures[ext] || !bytes.subarray(0,signatures[ext].length).equals(signatures[ext])) fail(400,'Unsupported or mismatched format');
  // Signature checks identify the format, not a malware or active-content scan.
  // Every type is downloaded as an opaque attachment on the isolated file host.
  if(['png','jpg','jpeg','webp'].includes(ext)) {
    try {
      const content=await sharp(bytes,{limitInputPixels:20000000,animated:false}).rotate().png().toBuffer();
      if(content.length>MAX_FILE)fail(413,'Re-encoded image exceeds limit');
      return {name:name.replace(/\.[^.]+$/,'.png'),content,image:true};
    } catch(e){if(e instanceof HttpError)throw e;fail(400,'Image cannot be decoded safely');}
  }
  return {name,content:bytes,image:false};
}
async function body(req, limit) {
  const length=Number(req.headers.get('content-length'));
  if(length>limit) fail(413,'Body too large');
  const reader=req.body?.getReader(); if(!reader) return Buffer.alloc(0);
  let size=0; const chunks=[];
  for(;;) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail(413,'Body too large');}chunks.push(value);}
  return Buffer.concat(chunks);
}
async function readJSON(req) {
  if(!req.headers.get('content-type')?.startsWith('application/json')) fail(415,'JSON required');
  try {return JSON.parse((await body(req,8192)).toString());}catch(e){if(e instanceof HttpError)throw e;fail(400,'Invalid JSON');}
}
export function createService({store,sites,enabled=false,clickCounting=false,now=()=>Date.now(),managementHTML='',studioHTML='',newsletter=null,managementAssets={},dashboard=null,publicPerMinute=600,modern=false,content=null,analytics=null,gaData=null,newsletterPublic=false}) {
  const domains=Object.keys(sites);
  // Only the exact verified hostname config selects the tenant, never a URL/body site value.
  const hosts=new Map(domains.flatMap(site=>['db','analytics','static','link',...(modern?['l','blog','lp','ads','m',...(newsletterPublic?['news']:[])]:[])].map(role=>[`${role}.${site}`,{site,role}])));
  async function session(req,site) {
    const s=await readSession(req,store,site,now());if(!s)fail(401,'Sign in required');return s;
  }
  function sameOrigin(req,u) {
    if(req.headers.get('origin')!==u.origin || req.headers.get('sec-fetch-site')==='cross-site') fail(403,'Same origin required');
  }
  function mutation(req,u,s) {
    sameOrigin(req,u);
    if(req.headers.get('x-csrf-token')!==s.csrf) fail(403,'CSRF check failed');
  }
  return async req => {
    try {
      const u=new URL(req.url), route=hosts.get(u.hostname);
      if(!enabled || !route || !sites[route.site].enabled || u.protocol!=='https:' || u.port || req.headers.has('x-forwarded-host')) return response(404,'Not found');
      const {site,role:rawRole}=route;
      const role=rawRole==='l'?'link':rawRole;
      const consoleRoute=u.pathname.startsWith('/api/') || u.pathname==='/manage' || u.pathname==='/upload' || !!managementAssets[u.pathname];
      if(modern && role==='news' && newsletter && !u.pathname.startsWith('/api/')) { const r=await newsletter.publicRoute(req,u); if(r) return r; }
      if(modern && !consoleRoute && role==='analytics' && analytics) return analytics(req);
      if(modern && !u.pathname.startsWith('/api/') && ['blog','lp','ads','news'].includes(role) && content) return content(req,role);
      // Central studio: private newsletter draft management lives on the m host as role 'news'.
      if(modern && role==='m' && content && !u.pathname.startsWith('/api/')) {
        if(u.pathname==='/newsletter' && !u.search && ['GET','HEAD'].includes(req.method)) { const m2=new URL(u); m2.pathname='/manage'; return content(new Request(m2,req),'news'); }
        if(u.pathname.startsWith('/preview/') || u.pathname.startsWith('/preview-frame/') || u.pathname==='/content.css' || u.pathname==='/content.js' || u.pathname==='/richtext.js' || u.pathname.startsWith('/vendor/')) return content(req,'news');
      }
      if(modern && role==='m' && studioHTML && ['GET','HEAD'].includes(req.method) && (u.pathname==='/' || u.pathname==='/manage') && !u.search) {
        return response(200,req.method==='HEAD'?null:studioHTML,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src https://static."+site+"; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
      }
      const linkHost=modern?'l':'link';
      if(modern && ((u.pathname==='/' && ['static','link'].includes(role)) || u.pathname==='/upload')) {
        return response(200,managementHTML,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
      }
      if(['link','static'].includes(role) && !(modern && consoleRoute)) {
        const bucket=Math.floor(now()/60000);
        const requests=await store.transaction(async()=>{
          await store.run('DELETE FROM public_limits WHERE site=? AND bucket<?',site,bucket-1);
          await store.run('INSERT INTO public_limits VALUES(?,?,?,1) ON CONFLICT(site,role,bucket) DO UPDATE SET requests=public_limits.requests+1',site,role,bucket);
          return (await store.get('SELECT requests FROM public_limits WHERE site=? AND role=? AND bucket=?',site,role,bucket)).requests;
        });
        if(requests>publicPerMinute)return response(429,'Rate limit reached',{'retry-after':'60'});
      }
      if(role==='analytics' && !(modern && consoleRoute)) {
        if(req.method!=='GET' && req.method!=='HEAD') return response(405);
        if(u.pathname!=='/' || u.search) return response(404);
        return response(302,'',{location:`https://db.${site}/`});
      }
      if(role==='link' && !(modern && consoleRoute)) {
        if(!['GET','HEAD'].includes(req.method)) return response(405);
        const id=u.pathname.slice(1);if(!(modern?LINK_ID:ID).test(id) || u.search) return response(404);
        const target=await store.transaction(async()=>{
          const row=await store.get('SELECT target,active,expires FROM links WHERE site=? AND id=?',site,id);
          if(!row || !row.active || (row.expires!==null && row.expires<=now())) return null;
          const prefetch=/prefetch|prerender/i.test((req.headers.get('purpose')||'')+' '+(req.headers.get('sec-purpose')||''));
          const bot=/bot|crawler|spider|facebookexternalhit|slack|discord|whatsapp|telegram|preview/i.test(req.headers.get('user-agent')||'');
          if(clickCounting && req.method==='GET' && !prefetch && !bot) {
            const day=new Date(now()).toISOString().slice(0,10);
            await store.run('INSERT INTO counts VALUES(?,?,?,1) ON CONFLICT(site,id,day) DO UPDATE SET requests=counts.requests+1',site,id,day);
            const cutoff=new Date(now()-90*86400000).toISOString().slice(0,10);
            await store.run('DELETE FROM counts WHERE site=? AND day<?',site,cutoff);
          }
          return validTarget(row.target,domains);
        });
        return target ? response(302,'',{location:target}) : response(404,'Not found');
      }
      if(role==='static' && !(modern && consoleRoute)) {
        if(!['GET','HEAD'].includes(req.method)) return response(405);
        const id=u.pathname.slice(1);if(!ID.test(id) || u.search) return response(404);
        const row=await store.get('SELECT name,content FROM files WHERE site=? AND id=? AND shared=1',site,id);
        if(!row) return response(404,'Not found');
        const filename=encodeURIComponent(row.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
        const isImage=/\.(png|jpe?g|webp)$/i.test(row.name);
        return response(200,req.method==='HEAD'?null:row.content,{'content-type':isImage?'image/png':'application/octet-stream','content-disposition':`${isImage?'inline':'attachment'}; filename="download"; filename*=UTF-8''${filename}`,'content-length':String(row.content.length)});
      }
      if(dashboard && !u.pathname.startsWith('/api/') && !u.pathname.startsWith('/manage')) {
        const legacy=dashboard(req);if(legacy)return legacy;
      }
      if(req.method==='GET' && u.pathname==='/manage' && !u.search) return response(200,managementHTML,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
      if(req.method==='GET' && managementAssets[u.pathname]) {
        const asset=managementAssets[u.pathname];
        return response(200,asset.body,{'content-type':asset.type,'content-security-policy':"default-src 'none'; frame-ancestors 'none'"});
      }
      if(!u.pathname.startsWith('/api/')) return response(404,'Not found');
      if(u.pathname==='/api/login' && req.method==='POST') {
        sameOrigin(req,u);
        const input=await readJSON(req), bucket=Math.floor(now()/900000);
        // Tenant-wide bound avoids storing IP addresses; persistent across restarts/workers.
        const tries=await store.transaction(async()=>{
          await store.run('DELETE FROM login_limits WHERE site=? AND bucket<?',site,bucket-1);
          await store.run('INSERT INTO login_limits VALUES(?,?,1) ON CONFLICT(site,bucket) DO UPDATE SET attempts=login_limits.attempts+1',site,bucket);
          return (await store.get('SELECT attempts FROM login_limits WHERE site=? AND bucket=?',site,bucket)).attempts;
        });
        if(tries>10) return response(429,'Too many attempts');
        if(!validPassword(input.password,sites[site].verifier,input.email)) return response(401,'Sign in failed');
        const token=hex(),csrf=hex();
        await store.run('DELETE FROM sessions WHERE site=? AND expires<=?',site,now());
        await store.run('INSERT INTO sessions VALUES(?,?,?,?)',site,digest(token),csrf,now()+SESSION_MS);
        return response(200,JSON.stringify({csrf}),{'content-type':'application/json; charset=utf-8','set-cookie':`__Host-console=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`});
      }
      const s=await session(req,site);
      if(role==='m' && req.method==='GET' && u.pathname==='/api/overview') {
        const n=async(q,...a)=>Number((await store.get(q,...a)).total);
        const content=async role=>{try{return await contentCounts(role);}catch{return {published:0,drafts:0};}};const contentCounts=async role=>({published:await n("SELECT count(*) AS total FROM content WHERE site=? AND role=? AND status='published'",site,role),drafts:await n("SELECT count(*) AS total FROM content WHERE site=? AND role=? AND status<>'published'",site,role)});
        const clicks=await store.get("SELECT COALESCE(SUM(requests),0) AS total FROM counts WHERE site=?",site);
        return json({site,lp:await content('lp'),ads:await content('ads'),blog:await content('blog'),news:await content('news'),links:await n('SELECT count(*) AS total FROM links WHERE site=?',site),clicks:Number(clicks.total),files:await n('SELECT count(*) AS total FROM files WHERE site=?',site),sharedFiles:await n('SELECT count(*) AS total FROM files WHERE site=? AND shared=1',site),
          hosts:{lp:`https://lp.${site}/`,ads:`https://ads.${site}/`,blog:`https://blog.${site}/manage`,links:`https://l.${site}/`,files:`https://static.${site}/`,analytics:`https://analytics.${site}/`}});
      }
      if(req.method==='GET' && u.pathname==='/api/ga' && role==='analytics' && gaData){try{return json(await gaData());}catch{return response(503,'GA4 data unavailable');}}
      if(req.method==='GET' && u.pathname==='/api/session') return json({csrf:s.csrf,site,role:rawRole,clickCounting,retentionDays:90});
      if(req.method!=='GET') mutation(req,u,s);
      if(req.method==='POST' && u.pathname==='/api/logout') {
        await store.run('DELETE FROM sessions WHERE site=? AND digest=?',site,s.digest);
        return response(204,null,{'set-cookie':'__Host-console=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});
      }
      // Newsletter admin API after the CSRF check: management on the m host, public host stays off unless newsletterPublic.
      if((role==='news'||role==='m') && newsletter && u.pathname.startsWith('/api/newsletter/')) {
        const r=await newsletter.admin(req,u,async slug=>{const rec=await store.get("SELECT custom_html FROM content WHERE site=? AND role='news' AND slug=? AND status='published'",site,slug);return rec?.custom_html||'';});
        if(r) return r;
      }
      if(modern) {
        if(u.pathname==='/api/content' || u.pathname.startsWith('/api/content/') || u.pathname==='/api/assets' || u.pathname==='/api/vpaths') {
          if(!content)return response(404);
          if(role==='m')return content(req,'news');
          if(!['blog','lp','ads','news'].includes(role))return response(404);
          return content(req,role);
        }
        if(u.pathname.startsWith('/api/files') && !['static','m'].includes(role))return response(404);
        if(u.pathname.startsWith('/api/links') && !['link','analytics'].includes(role))return response(404);
        if(role==='analytics' && req.method!=='GET')return response(405);
      }
      if(req.method==='GET' && u.pathname==='/api/links') return json({links:await store.all('SELECT id,target,label,active,expires FROM links WHERE site=? ORDER BY id DESC',site),daily:await store.all('SELECT id,day,requests FROM counts WHERE site=? ORDER BY day DESC',site),note:'Redirect requests, not unique people. Bots and previews can still affect counts.'});
      if(req.method==='POST' && u.pathname==='/api/links') {
        const input=await readJSON(req),target=validTarget(input.target,domains),label=String(input.label||'').trim();
        if(label.length>120 || /[\x00-\x1f]/.test(label)) fail(400,'Invalid label');
        const expires=input.expires??null;if(expires!==null && (!Number.isSafeInteger(expires) || expires<=now())) fail(400,'Invalid expiry');
        const id=await store.transaction(async()=>{
          const total=(await store.get('SELECT count(*) AS total FROM links WHERE site=?',site)).total;
          if(Number(total)>=1000)fail(413,'Site link cap reached');
          for(let attempt=0;attempt<5;attempt++){
            const candidate=modern?(input.slug?String(input.slug):randomBytes(5).toString('hex')):hex();
            if(modern && (!LINK_ID.test(candidate) || ['api','manage','upload'].includes(candidate)))fail(400,'Invalid short code');
            const r=await store.run('INSERT INTO links(site,id,target,label,expires) VALUES(?,?,?,?,?) ON CONFLICT(site,id) DO NOTHING',site,candidate,target,label,expires);
            if(r.changes)return candidate;if(modern && input.slug)fail(409,'Short code already in use');
          }
          fail(503,'Please retry');
        });
        return json({id,url:`https://${linkHost}.${site}/${id}`},201);
      }
      const link=u.pathname.match(/^\/api\/links\/([a-zA-Z0-9][a-zA-Z0-9_-]{2,63})$/);
      if(req.method==='POST' && link) {
        const input=await readJSON(req);
        if(modern && (input.target!==undefined || input.label!==undefined)) {
          const old=await store.get('SELECT target,label FROM links WHERE site=? AND id=?',site,link[1]);if(!old)return response(404);
          const target=validTarget(input.target??old.target,domains),label=String(input.label??old.label).trim();if(label.length>120 || /[\x00-\x1f]/.test(label))fail(400,'Invalid label');
          await store.run('UPDATE links SET target=?,label=? WHERE site=? AND id=?',target,label,site,link[1]);return json({target,label});
        }
        if(typeof input.active!=='boolean') fail(400,'Boolean active required');
        const r=await store.run('UPDATE links SET active=? WHERE site=? AND id=?',Number(input.active),site,link[1]);
        return r.changes?json({active:input.active}):response(404);
      }
      if(modern && req.method==='DELETE' && link) {
        return await store.transaction(async()=>{await store.run('DELETE FROM counts WHERE site=? AND id=?',site,link[1]);return (await store.run('DELETE FROM links WHERE site=? AND id=?',site,link[1])).changes?response(204,null):response(404);});
      }
      if(req.method==='GET' && u.pathname==='/api/files') return json({files:await store.all('SELECT id,name,length(content) AS size,shared FROM files WHERE site=? ORDER BY id DESC',site)});
      if(req.method==='POST' && u.pathname==='/api/files') {
        const bytes=await body(req,MAX_FILE),validated=await validateFile(u.searchParams.get('name'),bytes),id=hex();
        const {name,content}=validated;
        await store.transaction(async()=>{
          const used=(await store.get('SELECT coalesce(sum(length(content)),0) AS used FROM files WHERE site=?',site)).used;
          if(used+content.length>100*1024*1024) fail(413,'Site storage cap reached');
          await store.run('INSERT INTO files(site,id,name,content) VALUES(?,?,?,?)',site,id,name,content);
        });
        return json({id,name,shared:false},201);
      }
      const file=u.pathname.match(/^\/api\/files\/([a-f0-9]{32})$/);
      if(req.method==='POST' && file) {
        const input=await readJSON(req);if(typeof input.shared!=='boolean') fail(400,'Boolean shared required');
        const r=await store.run('UPDATE files SET shared=? WHERE site=? AND id=?',Number(input.shared),site,file[1]);
        return r.changes?json({shared:input.shared,url:input.shared?`https://static.${site}/${file[1]}`:null}):response(404);
      }
      if(req.method==='DELETE' && file) return (await store.run('DELETE FROM files WHERE site=? AND id=?',site,file[1])).changes?response(204,null):response(404);
      return response(404,'Not found');
    } catch(e) {return response(e instanceof HttpError?e.status:503,e instanceof HttpError?e.message:'Service unavailable');}
  };
}
