"use client";
import {useEffect,useState} from "react";
import {Guard} from "../../components/Guard";
import {Shell} from "../../components/Shell";
import {api} from "../../lib/api";

type Status={ai:{provider:string;model:string|null;live:boolean;label:string};whatsapp:{status:string;webhookHealthy:boolean;displayPhone?:string|null;liveEnabled:boolean;lastError?:string|null}};
type Business={automationEnabled:boolean;welcomeMessage:string|null;handoverMessage:string|null};

export default function Settings(){
 const [s,setS]=useState<Status>(),[b,setB]=useState<Business>(),[error,setError]=useState(""),[saved,setSaved]=useState("");
 const load=()=>Promise.all([api<Status>("/settings/status"),api<Business>("/business")]).then(([st,bu])=>{setS(st);setB(bu)}).catch(e=>setError(e.message));
 useEffect(()=>{load()},[]);
 const save=async(patch:Partial<Business>,msg:string)=>{setError("");setSaved("");try{await api("/business",{method:"PATCH",body:JSON.stringify(patch)});setSaved(msg);await load()}catch(e){setError((e as Error).message)}};
 const ready=s?.whatsapp.status==="CONNECTED"&&s.whatsapp.liveEnabled;
 return <Guard><Shell title="Settings" subtitle="AI agent behaviour and live activation.">
  {error&&<p className="error">{error}</p>}{saved&&<p className="pill" style={{display:"inline-block"}}>{saved}</p>}
  <div className="split">
   <div className="card">
    <h2>AI auto-replies</h2>
    <div className="row"><div className="grow"><strong>{b?.automationEnabled?"On":"Off"}</strong><p>When on, conversations in AI mode are answered automatically from published knowledge. Staff can take over any conversation from the inbox.</p></div>
     <button className="btn" disabled={!b} onClick={()=>save({automationEnabled:!b?.automationEnabled},b?.automationEnabled?"Auto-replies turned off":"Auto-replies turned on")}>{b?.automationEnabled?"Turn off":"Turn on"}</button></div>
    {!ready&&b?.automationEnabled&&<p className="error">WhatsApp is not live yet, so replies are recorded but not delivered.</p>}
    <div className="row"><div className="grow"><strong>AI provider: {s?.ai.provider??"…"}{s?.ai.model?` · ${s.ai.model}`:""}</strong><p>{s?.ai.label}</p></div><span className={s?.ai.live?"pill":"pill gray"}>{s?.ai.live?"Model":"Simulator"}</span></div>
   </div>
   <div className="card">
    <h2>WhatsApp</h2>
    <div className="row"><div className="grow"><strong>{s?.whatsapp.status??"Loading…"}{s?.whatsapp.displayPhone?` · ${s.whatsapp.displayPhone}`:""}</strong><p>{s?.whatsapp.lastError??`Webhook healthy: ${s?.whatsapp.webhookHealthy?"yes":"no"}`}</p></div><span className={ready?"pill":"pill gray"}>{ready?"Live":"Not live"}</span></div>
   </div>
  </div>
  <form className="card form-grid" onSubmit={e=>{e.preventDefault();save({welcomeMessage:b?.welcomeMessage||null,handoverMessage:b?.handoverMessage||null},"Messages saved")}}>
   <h2 style={{gridColumn:"1/-1"}}>Automatic messages</h2>
   <label>Welcome message (first contact)<textarea className="input" rows={3} maxLength={1000} value={b?.welcomeMessage??""} onChange={e=>b&&setB({...b,welcomeMessage:e.target.value})} placeholder="Hi! Thanks for contacting us. How can we help?"/></label>
   <label>Handover message<textarea className="input" rows={3} maxLength={1000} value={b?.handoverMessage??""} onChange={e=>b&&setB({...b,handoverMessage:e.target.value})} placeholder="Thanks — a member of our team will reply shortly."/></label>
   <button className="btn" disabled={!b}>Save messages</button>
  </form>
 </Shell></Guard>
}
