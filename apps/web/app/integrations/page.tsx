"use client";
import {useEffect,useState} from "react";
import {Guard} from "../../components/Guard";
import {Shell} from "../../components/Shell";
import {api} from "../../lib/api";

type Connection={id:string;phoneNumberId:string;wabaId:string|null;displayPhone:string|null;verifiedName:string|null;status:string;webhookHealthy:boolean;lastWebhookAt:string|null;lastError:string|null;hasAccessToken:boolean};
type State={connection:Connection|null;webhookUrl:string;liveEnabled:boolean;server:{appSecret:boolean;verifyToken:boolean;encryptionKey:boolean;envAccessToken:string|null}};

function Check({ok,label,hint}:{ok:boolean;label:string;hint:string}){return <div className="row"><span className={ok?"pill":"pill gray"}>{ok?"Ready":"Missing"}</span><div className="grow"><strong>{label}</strong><p>{hint}</p></div></div>}

export default function Integrations(){
 const [state,setState]=useState<State>(),[form,setForm]=useState({phoneNumberId:"",wabaId:"",displayPhone:"",accessToken:""}),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const load=()=>api<State>("/whatsapp/connection").then(s=>{setState(s);if(s.connection)setForm(f=>({...f,phoneNumberId:s.connection!.phoneNumberId,wabaId:s.connection!.wabaId??"",displayPhone:s.connection!.displayPhone??""}))}).catch(e=>setError(e.message));
 useEffect(()=>{load()},[]);
 const run=async(fn:()=>Promise<unknown>,ok:string)=>{setBusy(true);setError("");setNotice("");try{await fn();setNotice(ok);await load()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 const save=(e:React.FormEvent)=>{e.preventDefault();const body:Record<string,string>={phoneNumberId:form.phoneNumberId.trim(),wabaId:form.wabaId.trim(),displayPhone:form.displayPhone.trim()};if(form.accessToken.trim())body.accessToken=form.accessToken.trim();run(()=>api("/whatsapp/connection",{method:"PUT",body:JSON.stringify(body)}),"Saved. Now run the connection test.").then(()=>setForm(f=>({...f,accessToken:""})))};
 const test=()=>run(()=>api("/whatsapp/connection/test",{method:"POST",body:"{}"}),"Connected — Meta accepted the token and phone number ID.");
 const remove=()=>{if(confirm("Disconnect this WhatsApp number? Incoming messages will stop being processed."))run(()=>api("/whatsapp/connection",{method:"DELETE"}),"Disconnected.")};
 const c=state?.connection;
 return <Guard><Shell title="Integrations" subtitle="Connect your WhatsApp Business number through Meta's Cloud API.">
  {!state?.liveEnabled&&<div className="notice"><strong>Live sending is switched off on the server.</strong> You can save and test the connection now; replies are only delivered once an administrator sets <code>WHATSAPP_LIVE_ENABLED=true</code>.</div>}
  {error&&<p className="error">{error}</p>}{notice&&<p className="pill" style={{display:"inline-block"}}>{notice}</p>}
  <div className="split">
   <form className="card form-grid" onSubmit={save}>
    <h2 style={{gridColumn:"1/-1"}}>WhatsApp Cloud API</h2>
    <label>Phone number ID<input className="input" required inputMode="numeric" value={form.phoneNumberId} onChange={e=>setForm({...form,phoneNumberId:e.target.value})} placeholder="e.g. 106540352242922"/></label>
    <label>WhatsApp Business Account ID<input className="input" inputMode="numeric" value={form.wabaId} onChange={e=>setForm({...form,wabaId:e.target.value})}/></label>
    <label>Display phone (optional)<input className="input" value={form.displayPhone} onChange={e=>setForm({...form,displayPhone:e.target.value})} placeholder="+220 …"/></label>
    <label>Permanent access token<input className="input" type="password" autoComplete="off" value={form.accessToken} onChange={e=>setForm({...form,accessToken:e.target.value})} placeholder={c?.hasAccessToken?"Saved — leave blank to keep":"System-user token from Meta Business Settings"}/></label>
    <div style={{gridColumn:"1/-1",display:"flex",gap:8,flexWrap:"wrap"}}>
     <button className="btn" disabled={busy}>Save</button>
     {c&&<button type="button" className="btn secondary" disabled={busy} onClick={test}>Test connection</button>}
     {c&&<button type="button" className="btn secondary" disabled={busy} onClick={remove}>Disconnect</button>}
    </div>
    <p style={{gridColumn:"1/-1",fontSize:12,color:"var(--muted)"}}>Tokens are encrypted with AES-256-GCM before they are stored and are never shown again.</p>
   </form>
   <div className="card">
    <h2>Status</h2>
    <div className="row"><span className={c?.status==="CONNECTED"?"pill":"pill gray"}>{c?.status??"NOT CONNECTED"}</span><div className="grow"><strong>{c?.verifiedName??c?.displayPhone??"No number saved"}</strong><p>{c?.lastError??(c?.lastWebhookAt?`Last webhook ${new Date(c.lastWebhookAt).toLocaleString()}`:"No webhook received yet")}</p></div></div>
    <h2 style={{marginTop:18}}>Webhook setup in Meta</h2>
    <div className="row"><div className="grow"><strong>Callback URL</strong><p style={{wordBreak:"break-all"}}><code>{state?.webhookUrl??"…"}</code></p></div><button className="btn secondary" type="button" onClick={()=>state&&navigator.clipboard.writeText(state.webhookUrl)}>Copy</button></div>
    <div className="row"><div className="grow"><strong>Verify token</strong><p>Use the value of <code>META_VERIFY_TOKEN</code> from the server environment. Subscribe to the <code>messages</code> field.</p></div></div>
    <h2 style={{marginTop:18}}>Server checklist</h2>
    <Check ok={!!state?.server.appSecret} label="META_APP_SECRET" hint="Verifies that webhooks really come from Meta."/>
    <Check ok={!!state?.server.verifyToken} label="META_VERIFY_TOKEN" hint="Required for Meta's webhook handshake."/>
    <Check ok={!!state?.server.encryptionKey} label="ENCRYPTION_KEY" hint="Required to store access tokens securely."/>
    <Check ok={!!state?.liveEnabled} label="WHATSAPP_LIVE_ENABLED" hint="Master switch for real delivery to customers."/>
   </div>
  </div>
 </Shell></Guard>
}
