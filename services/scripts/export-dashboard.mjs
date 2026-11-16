import {cpSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';import {resolve,join} from 'node:path';
const [source,target]=process.argv.slice(2);
if(!source||!target)throw new Error('Usage: node scripts/export-dashboard.mjs SOURCE_REPO TARGET_DIRECTORY');
const src=resolve(source),dst=resolve(target);
if(src===dst || dst.startsWith(src+'/'))throw new Error('Use a separate export directory');
for(const p of ['index.html','assets/dashboard.js','assets/dashboard.css','data/analytics.json.enc'])if(!existsSync(join(src,p)))throw new Error('Missing required dashboard file: '+p);
const cipher=JSON.parse(readFileSync(join(src,'data/analytics.json.enc'),'utf8'));
if(cipher.v!==1 || !['salt','iv','ct'].every(k=>typeof cipher[k]==='string'))throw new Error('Encrypted snapshot envelope required');
mkdirSync(dst,{recursive:true});cpSync(join(src,'assets'),join(dst,'assets'),{recursive:true});mkdirSync(join(dst,'data'),{recursive:true});
// Deliberate local-only copy. Original repository is never modified.
let html=readFileSync(join(src,'index.html'),'utf8');
html=html.replace('</nav>','<a href="/manage">Dateien &amp; Kurzlinks ↗</a></nav>');writeFileSync(join(dst,'index.html'),html);
cpSync(join(src,'data/analytics.json.enc'),join(dst,'data/analytics.json.enc'));
console.log('Local encrypted dashboard export ready. No upload, push or deployment performed.');
