// Server-side opening of the existing encrypted GA4 snapshot for an authenticated session.
// The ciphertext stays exactly as the existing publisher writes it; only the password moves into a private server variable.
const b64=s=>Uint8Array.from(Buffer.from(s,'base64'));
export function createGaData({password,fetchImpl=fetch,ttl=300000,now=Date.now}){
  if(!password)return null;
  let cached=null;
  return async function gaData(){
    if(cached&&now()-cached.at<ttl)return cached.data;
    const r=await fetchImpl('https://db.philipp-paulik.de/data/analytics.json.enc',{redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw new Error('upstream');
    const p=await r.json();
    if(p.v!==1)throw new Error('format');
    const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(p.salt),iterations:600000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['decrypt']);
    const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(p.iv)},key,b64(p.ct));
    const data=JSON.parse(new TextDecoder().decode(pt));
    cached={at:now(),data};
    return data;
  };
}
