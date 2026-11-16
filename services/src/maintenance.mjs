export async function maintain(store,now=Date.now()) {
  const day=new Date(now-90*86400000).toISOString().slice(0,10);
  return store.transaction(async()=>{
    await store.run('DELETE FROM counts WHERE day<?',day);
    await store.run('DELETE FROM sessions WHERE expires<=?',now);
    await store.run('DELETE FROM login_limits WHERE bucket<?',Math.floor(now/900000)-1);
    await store.run('DELETE FROM public_limits WHERE bucket<?',Math.floor(now/60000)-1);
  });
}
