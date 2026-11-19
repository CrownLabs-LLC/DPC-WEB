import { looksLikeSecretKey } from './admin-config.js';
// Public configuration only. All identity and entitlement decisions stay in
// authenticated Supabase RPCs; this endpoint never receives a session or email.
export function createHandler({env=process.env}={}) {
  return function handler(req,res) {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'method_not_allowed'});}
    const url=env.SUPABASE_URL?.replace(/\/$/,''), anon=env.SUPABASE_ANON_KEY;
    if(env.DPC_INTRODUCTION_ENABLED!=='true'||!url||!anon||looksLikeSecretKey(anon)||anon===env.SUPABASE_SERVICE_ROLE_KEY)return res.status(503).json({error:'unavailable'});
    try {
      const parsed=new URL(url);
      if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error();
      const expected=env.VERCEL_ENV==='production'?'ebiuspbgzggrdiaswpcc.supabase.co':'hohbsqkmrlhkstojfdgx.supabase.co';
      if(parsed.hostname!==expected)throw Error();
    } catch {return res.status(503).json({error:'unavailable'});}
    return res.status(200).json({supabaseUrl:url,anonKey:anon,isStaging:env.VERCEL_ENV!=='production'});
  };
}
export default createHandler();
