"use client";
import {useEffect,useRef,useState} from "react";
import {Guard} from "../../components/Guard";
import {Shell} from "../../components/Shell";
import {api} from "../../lib/api";

type Connection={id:string;phoneNumberId:string;wabaId:string|null;displayPhone:string|null;verifiedName:string|null;status:string;webhookHealthy:boolean;lastWebhookAt:string|null;lastError:string|null;hasAccessToken:boolean;ownershipVerified?:boolean};
type State={connection:Connection|null;webhookUrl:string;liveEnabled:boolean;server:{appSecret:boolean;verifyToken:boolean;encryptionKey:boolean}};
type Embedded={enabled:boolean;appId:string|null;configId:string|null;graphVersion:string};
declare global { interface Window { FB?: { init:(config:Record<string,unknown>)=>void;login:(callback:(response:any)=>void,options:Record<string,unknown>)=>void }; fbAsyncInit?:()=>void } }

function Check({ok,label,hint}:{ok:boolean;label:string;hint:string}){return <div className="row"><span className={ok?"pill":"pill gray"}>{ok?"Ready":"Missing"}</span><div className="grow"><strong>{label}</strong><p>{hint}</p></div></div>}

export default function Integrations(){
 const [state,setState]=useState<State>(),[embedded,setEmbedded]=useState<Embedded>(),[form,setForm]=useState({phoneNumberId:"",wabaId:"",displayPhone:"",accessToken:""}),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);const signup=useRef<{code?:string;phoneNumberId?:string;wabaId?:string}>({});
 const load=()=>api<State>("/whatsapp/connection").then(s=>{setState(s);if(s.connection)setForm(f=>({...f,phoneNumberId:s.connection!.phoneNumberId,wabaId:s.connection!.wabaId??"",displayPhone:s.connection!.displayPhone??""}))}).catch(e=>setError(e.message));
 useEffect(()=>{load();api<Embedded>("/whatsapp/embedded/config").then(config=>{setEmbedded(config);if(!config.enabled||!config.appId)return;window.fbAsyncInit=()=>window.FB?.init({appId:config.appId,cookie:true,xfbml:false,version:config.graphVersion});if(!document.getElementById("facebook-jssdk")){const script=document.createElement("script");script.id="facebook-jssdk";script.async=true;script.defer=true;script.crossOrigin="anonymous";script.src="https://connect.facebook.net/en_US/sdk.js";document.body.appendChild(script)}}).catch(()=>{});const listener=(event:MessageEvent)=>{let host="";try{host=new URL(event.origin).hostname}catch{return}if(!/(^|\.)facebook\.com$|(^|\.)facebook\.net$/.test(host))return;let data:any=event.data;try{if(typeof data==="string")data=JSON.parse(data)}catch{return}if(data?.type==="WA_EMBEDDED_SIGNUP"&&data?.data?.phone_number_id&&data?.data?.waba_id){signup.current.phoneNumberId=String(data.data.phone_number_id);signup.current.wabaId=String(data.data.waba_id)}};window.addEventListener("message",listener);return()=>window.removeEventListener("message",listener)},[]);
 const run=async(fn:()=>Promise<unknown>,ok:string)=>{setBusy(true);setError("");setNotice("");try{await fn();setNotice(ok);await load()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 const save=(e:React.FormEvent)=>{e.preventDefault();const body:Record<string,string>={phoneNumberId:form.phoneNumberId.trim(),wabaId:form.wabaId.trim(),displayPhone:form.displayPhone.trim()};if(form.accessToken.trim())body.accessToken=form.accessToken.trim();run(()=>api("/whatsapp/connection",{method:"PUT",body:JSON.stringify(body)}),"Saved. Now run the connection test.").then(()=>setForm(f=>({...f,accessToken:""})))};
 const test=()=>run(()=>api("/whatsapp/connection/test",{method:"POST",body:"{}"}),"Connected — Meta accepted the token and phone number ID.");
 const remove=()=>{if(confirm("Disconnect this WhatsApp number? Incoming messages will stop being processed."))run(()=>api("/whatsapp/connection",{method:"DELETE"}),"Disconnected.")};
 const connectEmbedded=()=>{setError("");setNotice("");signup.current={};if(!embedded?.configId||!window.FB)return setError("Meta Embedded Signup is still loading. Try again in a moment.");window.FB.login(async response=>{const code=response?.authResponse?.code;if(!code)return setError("Meta signup was cancelled or did not return an authorization code.");signup.current.code=String(code);for(let i=0;i<20&&!signup.current.phoneNumberId;i++)await new Promise(resolve=>setTimeout(resolve,250));const data=signup.current;if(!data.phoneNumberId||!data.wabaId)return setError("Meta did not return the WhatsApp number details. Complete every signup step and try again.");run(()=>api("/whatsapp/embedded/complete",{method:"POST",body:JSON.stringify(data)}),"WhatsApp connected successfully through Meta.")},{config_id:embedded.configId,response_type:"code",override_default_response_type:true,extras:{setup:{}}})};
 const c=state?.connection;
 return <Guard><Shell title="Integrations" subtitle="Connect your WhatsApp Business number through Meta's Cloud API.">
  {!state?.liveEnabled&&<div className="notice"><strong>Live sending is switched off on the server.</strong> You can save and test the connection now; replies are only delivered once an administrator sets <code>WHATSAPP_LIVE_ENABLED=true</code>.</div>}
  {error&&<p className="error">{error}</p>}{notice&&<p className="pill" style={{display:"inline-block"}}>{notice}</p>}
  {embedded?.enabled&&<div className="card" style={{marginBottom:18}}><h2>Fast connection</h2><p className="muted">Sign in with Meta, choose your business and WhatsApp number, and OceanBrown will configure the connection securely.</p><button className="btn" disabled={busy} onClick={connectEmbedded}>Connect with Facebook</button></div>}
  <div className="integration-layout">
   <form className="card integration-form" onSubmit={save}>
    <h2 className="integration-span">WhatsApp Cloud API</h2>
    <label>Phone number ID<input className="input" required inputMode="numeric" value={form.phoneNumberId} onChange={e=>setForm({...form,phoneNumberId:e.target.value})} placeholder="e.g. 106540352242922"/></label>
    <label>WhatsApp Business Account ID<input className="input" inputMode="numeric" value={form.wabaId} onChange={e=>setForm({...form,wabaId:e.target.value})}/></label>
    <label>Display phone (optional)<input className="input" value={form.displayPhone} onChange={e=>setForm({...form,displayPhone:e.target.value})} placeholder="+220 …"/></label>
    <label>Permanent access token<input className="input" type="password" autoComplete="off" value={form.accessToken} onChange={e=>setForm({...form,accessToken:e.target.value})} placeholder={c?.hasAccessToken?"Saved — leave blank to keep":"System-user token from Meta Business Settings"}/></label>
    <div className="actions integration-span">
     <button className="btn" disabled={busy}>Save</button>
     {c&&<button type="button" className="btn secondary" disabled={busy} onClick={test}>Test connection</button>}
     {c&&<button type="button" className="btn secondary" disabled={busy} onClick={remove}>Disconnect</button>}
    </div>
    <p className="small muted integration-span integration-help">Tokens are encrypted with AES-256-GCM before they are stored and are never shown again.</p>
   </form>
   <div className="card integration-status">
    <h2>Status</h2>
    <div className="row"><span className={c?.status==="CONNECTED"?"pill":"pill gray"}>{c?.status==="CONNECTED"&&c.ownershipVerified===false?"UNVERIFIED — run Test connection":c?.status??"NOT CONNECTED"}</span><div className="grow"><strong>{c?.verifiedName??c?.displayPhone??"No number saved"}</strong><p>{c?.lastError??(c?.lastWebhookAt?`Last webhook ${new Date(c.lastWebhookAt).toLocaleString()}`:"No webhook received yet")}</p></div></div>
    <h2 style={{marginTop:18}}>Webhook setup in Meta</h2>
    <div className="row integration-webhook"><div className="grow"><strong>Callback URL</strong><p><code>{state?.webhookUrl??"…"}</code></p></div><button className="btn secondary" type="button" onClick={()=>state&&navigator.clipboard.writeText(state.webhookUrl)}>Copy</button></div>
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
