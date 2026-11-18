import {createHash} from 'node:crypto';
export async function readSession(req,store,site,now=Date.now()){
 const token=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-console='))?.slice(15);
 if(!token||!/^[a-f0-9]{32}$/.test(token))return null;
 const digest=createHash('sha256').update(token).digest('hex');
 const s=await store.get('SELECT csrf,expires FROM sessions WHERE site=? AND digest=?',site,digest);
 return s&&s.expires>now?{...s,digest}:null;
}
