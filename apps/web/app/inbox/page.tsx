"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {Guard} from "../../components/Guard";
import {Shell} from "../../components/Shell";
import {api} from "../../lib/api";

type Message={id?:string;body:string;direction:string;createdAt:string;status?:string;metadata?:{transport?:string;source?:string;error?:string;action?:string}|null};
type Note={id:string;body:string;createdAt:string;author:{name:string}};
type Customer={name:string;phone:string;optedOutAt?:string|null};
type Conv={id:string;mode:string;status:string;customer:Customer;messages:Message[];notes?:Note[];assignedTo?:{name:string}|null;serviceWindowOpen?:boolean};
type SavedReply={id:string;title:string;body:string;shortcut:string};

const ticks:Record<string,string>={QUEUED:"🕓 queued",SENT:"✓ sent",DELIVERED:"✓✓ delivered",READ:"✓✓ read",FAILED:"⚠ failed",UNCERTAIN:"? uncertain",RECEIVED:"received"};

export default function Inbox(){
 const [rows,setRows]=useState<Conv[]>([]),[chosen,setChosen]=useState<Conv>(),[text,setText]=useState(""),[note,setNote]=useState(""),[query,setQuery]=useState(""),[filter,setFilter]=useState("OPEN"),[saved,setSaved]=useState<SavedReply[]>([]),[error,setError]=useState(""),[sending,setSending]=useState(false);
 const chosenId=useRef<string|undefined>(undefined);
 const bottom=useRef<HTMLDivElement>(null);
 const select=useCallback(async(id:string)=>{chosenId.current=id;try{const c=await api<Conv>(`/conversations/${id}`);if(chosenId.current===id)setChosen(c)}catch(e){setError((e as Error).message)}},[]);
 const loadList=useCallback(async()=>{const list=await api<Conv[]>(`/conversations${filter==="ALL"?"":`?status=${filter}`}`);setRows(list);const id=chosenId.current??list[0]?.id;if(id)await select(id);else setChosen(undefined)},[filter,select]);
 useEffect(()=>{loadList().catch(e=>setError(e.message));api<SavedReply[]>("/saved-replies").then(setSaved).catch(()=>{})},[loadList]);
 // Poll for new WhatsApp messages and delivery receipts.
 useEffect(()=>{const t=setInterval(()=>{if(document.visibilityState==="visible")loadList().catch(()=>{})},8000);return()=>clearInterval(t)},[loadList]);
 useEffect(()=>{bottom.current?.scrollIntoView({block:"end"})},[chosen?.messages.length,chosen?.id]);
 const filtered=useMemo(()=>rows.filter(c=>`${c.customer.name} ${c.customer.phone} ${c.messages[0]?.body??""}`.toLowerCase().includes(query.toLowerCase())),[rows,query]);
 const act=async(fn:()=>Promise<unknown>)=>{setError("");try{await fn();await loadList()}catch(e){setError((e as Error).message)}};
 const changeMode=(mode:string)=>chosen&&act(()=>api(`/conversations/${chosen.id}/mode`,{method:"PATCH",body:JSON.stringify({mode})}));
 const setStatus=(status:string)=>chosen&&act(()=>api(`/conversations/${chosen.id}`,{method:"PATCH",body:JSON.stringify({status})}));
 const send=async(e:React.FormEvent)=>{e.preventDefault();if(!text.trim()||!chosen)return;setSending(true);setError("");try{await api(`/conversations/${chosen.id}/messages`,{method:"POST",body:JSON.stringify({body:text.trim(),clientId:crypto.randomUUID()})});setText("");await loadList()}catch(x){setError((x as Error).message)}finally{setSending(false)}};
 const addNote=async(e:React.FormEvent)=>{e.preventDefault();if(!note.trim()||!chosen)return;await act(()=>api(`/conversations/${chosen.id}/notes`,{method:"POST",body:JSON.stringify({body:note.trim()})}));setNote("")};
 const blocked=chosen?.customer.optedOutAt?"This customer opted out (STOP). You can't message them until they send START.":null;
 return <Guard><Shell title="Shared inbox" subtitle="AI-assisted and human WhatsApp conversations in one place."><div className="card inbox">
  <section className="threads"><div style={{padding:16,display:"grid",gap:8}}><input className="input" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search conversations"/><select className="input" value={filter} onChange={e=>{setFilter(e.target.value);chosenId.current=undefined}}><option value="OPEN">Open</option><option value="PENDING">Pending</option><option value="RESOLVED">Resolved</option><option value="ALL">All</option></select></div>
   {filtered.map(c=><button className={`row thread-row ${chosen?.id===c.id?"selected":""}`} key={c.id} onClick={()=>select(c.id)}><span className="avatar">{c.customer.name[0]}</span><div className="grow"><strong>{c.customer.name}</strong><p>{c.messages[0]?.body??"No messages"}</p></div><span className="pill gray">{c.mode}</span></button>)}
   {!filtered.length&&<div className="empty">No matching conversations.</div>}</section>
  <section className="thread">{chosen?<>
   <div className="top"><div><h2>{chosen.customer.name}</h2><p>{chosen.customer.phone}{chosen.assignedTo?` · assigned to ${chosen.assignedTo.name}`:""}</p></div><div className="actions">
    {chosen.mode!=="HUMAN"&&<button className="btn secondary" onClick={()=>changeMode("HUMAN")}>Take over</button>}
    {chosen.mode==="HUMAN"&&<button className="btn secondary" onClick={()=>changeMode("AI")}>Return to AI</button>}
    <button className="btn secondary" onClick={()=>changeMode(chosen.mode==="PAUSED"?"HUMAN":"PAUSED")}>{chosen.mode==="PAUSED"?"Resume":"Pause"}</button>
    {chosen.status!=="RESOLVED"?<button className="btn secondary" onClick={()=>setStatus("RESOLVED")}>Resolve</button>:<button className="btn secondary" onClick={()=>setStatus("OPEN")}>Reopen</button>}
   </div></div>
   <div className="statusbar"><span className="pill">{chosen.status}</span><span className="pill blue">{chosen.mode} mode</span><span className={chosen.serviceWindowOpen?"pill":"pill gray"}>{chosen.serviceWindowOpen?"24h window open":"24h window closed"}</span></div>
   <div className="messages">{chosen.messages.map((m,i)=><div className={m.direction==="OUTBOUND"?"bubble out":"bubble"} key={m.id??i}>{m.body}<small>{new Date(m.createdAt).toLocaleString()} · {m.metadata?.source==="ai"?"🤖 ":""}{m.direction==="OUTBOUND"?(m.metadata?.transport==="simulator"?"simulated":ticks[m.status??""]??m.status):"customer"}{m.metadata?.error?` — ${m.metadata.error}`:""}</small></div>)}<div ref={bottom}/></div>
   {saved.length>0&&<select className="input" aria-label="Saved reply" defaultValue="" onChange={e=>{const item=saved.find(s=>s.id===e.target.value);if(item)setText(item.body);e.currentTarget.value=""}}><option value="">Insert a saved reply…</option>{saved.map(s=><option key={s.id} value={s.id}>{s.shortcut} · {s.title}</option>)}</select>}
   {blocked&&<p className="error">{blocked}</p>}
   <form className="compose" onSubmit={send}><input className="input" value={text} maxLength={4096} disabled={!!blocked} onChange={e=>setText(e.target.value)} placeholder="Type a reply…"/><button className="btn" disabled={sending||!!blocked}>{sending?"Sending…":"Send"}</button></form>
   <details style={{marginTop:12}}><summary>Internal notes ({chosen.notes?.length??0})</summary>{chosen.notes?.map(n=><p key={n.id} style={{fontSize:13}}><strong>{n.author.name}:</strong> {n.body} <small style={{color:"var(--muted)"}}>{new Date(n.createdAt).toLocaleString()}</small></p>)}<form className="compose" onSubmit={addNote}><input className="input" value={note} onChange={e=>setNote(e.target.value)} placeholder="Add a private note for your team"/><button className="btn secondary">Add note</button></form></details>
   {error&&<p className="error">{error}</p>}
  </>:<div className="empty">No conversation selected</div>}</section>
 </div></Shell></Guard>
}
