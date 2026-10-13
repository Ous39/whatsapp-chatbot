"use client";
import {useEffect,useRef,useState} from "react";
import {Guard} from "../../components/Guard";
import {Shell} from "../../components/Shell";
import {api,API} from "../../lib/api";

type Result={text:string;action:string;provider:string;language?:string;sources:{title:string}[];audio?:{base64:string;mime:string}|null;voiceError?:string|null;transcript?:string;detectedLanguage?:string|null};
type VoiceStatus={enabled:boolean;stt:{provider:string;ready:boolean};tts:Record<"en"|"fr"|"wo",{provider:string;ready:boolean}>};
const LANGS=[["auto","Auto-detect"],["en","English"],["fr","Français"],["wo","Wolof"]] as const;
const LABEL:Record<string,string>={en:"English",fr:"French",wo:"Wolof"};
const EXAMPLES:Record<string,string>={en:"What services do you provide?",fr:"Bonjour, quels services proposez-vous ?",wo:"Nanga def, lan ngeen di def?"};

export default function Agent(){
 const [message,setMessage]=useState(EXAMPLES.en),[lang,setLang]=useState<string>("auto"),[result,setResult]=useState<Result>(),[error,setError]=useState(""),[busy,setBusy]=useState(false),[recording,setRecording]=useState(false),[status,setStatus]=useState<VoiceStatus>();
 const recorder=useRef<MediaRecorder|null>(null),chunks=useRef<Blob[]>([]),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>{api<VoiceStatus>("/voice/status").then(setStatus).catch(()=>{})},[]);
 const done=(r:Result)=>{setResult(r);localStorage.setItem("ob_simulator_tested","true")};
 const runText=async(speak:boolean)=>{setError("");setBusy(true);try{done(speak?await api<Result>("/simulator/speak",{method:"POST",body:JSON.stringify({message,language:lang==="auto"?undefined:lang})}):await api<Result>("/simulator",{method:"POST",body:JSON.stringify({message})}))}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 const start=async()=>{setError("");try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const type=["audio/webm;codecs=opus","audio/ogg;codecs=opus","audio/mp4"].find(t=>MediaRecorder.isTypeSupported(t))??"";const rec=new MediaRecorder(stream,type?{mimeType:type}:undefined);chunks.current=[];rec.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data)};rec.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());setRecording(false);const blob=new Blob(chunks.current,{type:rec.mimeType||"audio/webm"});if(blob.size<1000){setError("The recording was too short.");return}setBusy(true);try{const q=lang==="auto"?"":`?language=${lang}`;const res=await fetch(`${API}/simulator/voice${q}`,{method:"POST",credentials:"include",headers:{"Content-Type":blob.type.split(";")[0]||"audio/webm"},body:blob});const json=await res.json();if(!res.ok)throw new Error(json.error??`Request failed (${res.status})`);setMessage(json.transcript);done(json)}catch(e){setError((e as Error).message)}finally{setBusy(false)}};recorder.current=rec;rec.start();setRecording(true);timer.current=setTimeout(()=>rec.state==="recording"&&rec.stop(),60000)}catch{setError("Microphone access was blocked. Allow the microphone for this site and try again.")}};
 const stop=()=>{clearTimeout(timer.current);if(recorder.current?.state==="recording")recorder.current.stop()};
 const sttReady=!!status?.enabled&&!!status.stt.ready;
 return <Guard><Shell title="Agent playground" subtitle="Test grounded answers by text or voice in English, French and Wolof.">
  <div className="notice"><strong>Playground — never sends to customers.</strong> Uses the same AI provider, voices and published knowledge as live WhatsApp replies.</div>
  <div className="card sim"><div className="simulator">
   <div>
    <h2>Customer message</h2>
    <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
     <select className="input" style={{maxWidth:180}} value={lang} onChange={e=>{setLang(e.target.value);if(e.target.value!=="auto")setMessage(EXAMPLES[e.target.value]??message)}} aria-label="Language">{LANGS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
     {recording?<button className="btn" onClick={stop}>■ Stop recording</button>:<button className="btn secondary" disabled={busy||!sttReady} onClick={start} title={sttReady?"Record a voice note":"Set STT_PROVIDER on the server to enable voice"}>🎤 Record voice note</button>}
    </div>
    <textarea className="input" rows={6} value={message} onChange={e=>setMessage(e.target.value)}/>
    <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
     <button className="btn" disabled={busy} onClick={()=>runText(false)}>{busy?"Working…":"Run as text"}</button>
     <button className="btn secondary" disabled={busy} onClick={()=>runText(true)}>Answer with voice</button>
    </div>
    {recording&&<p className="pill" style={{display:"inline-block",marginTop:8}}>● Recording… speak in English, French or Wolof (max 60s)</p>}
    {error&&<p className="error">{error}</p>}
    {status&&<p style={{fontSize:12,color:"var(--muted)",marginTop:12}}>Speech-to-text: {status.stt.ready?status.stt.provider:"not configured"} · Voices: {(["en","fr","wo"] as const).map(l=>`${LABEL[l]} ${status.tts[l].ready?"✓":"✗"}`).join(" · ")}</p>}
   </div>
   <div>
    <h2>Agent response</h2>
    {result?.transcript&&<p style={{fontSize:13}}><strong>Heard:</strong> “{result.transcript}”</p>}
    <div className="answer">{result?.text??"Run a simulation to preview the response."}</div>
    {result?.audio&&<audio controls autoPlay src={`data:${result.audio.mime};base64,${result.audio.base64}`} style={{width:"100%",marginTop:8}}/>}
    {result?.voiceError&&<p style={{fontSize:12,color:"var(--muted)"}}>Voice: {result.voiceError}</p>}
    {result&&<p style={{fontSize:12,color:"var(--muted)"}}>Language: {LABEL[result.language??""]??"auto"} · Provider: {result.provider} · Action: {result.action} · Sources: {result.sources.map(s=>s.title).join(", ")||"none"}</p>}
   </div>
  </div></div>
 </Shell></Guard>
}
