"use client";
import {useEffect,useState} from "react";
import {Guard} from "./Guard";
import {Shell} from "./Shell";
import {api} from "../lib/api";

type Field={name:string;label:string;type?:"text"|"email"|"password"|"datetime-local"|"textarea"|"select"|"checkbox";options?:{label:string;value:string}[];required?:boolean};
const read=(row:any,key:string)=>key.split(".").reduce((value,part)=>value?.[part],row);

export function ResourcePage({title,subtitle,path,columns,fields=[]}:{title:string;subtitle:string;path:string;columns:{key:string;label:string}[];fields?:Field[]}){
 const [rows,setRows]=useState<any[]>([]),[show,setShow]=useState(false),[form,setForm]=useState<Record<string,any>>({}),[error,setError]=useState(""),[loading,setLoading]=useState(true),[query,setQuery]=useState("");
 const load=()=>{setLoading(true);api<any[]>(path).then(setRows).catch(e=>setError(e.message)).finally(()=>setLoading(false))};
 useEffect(load,[path]);
 const filtered=rows.filter(row=>columns.some(c=>String(read(row,c.key)??"").toLowerCase().includes(query.toLowerCase())));
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setError("");try{await api(path,{method:"POST",body:JSON.stringify(form)});setShow(false);setForm({});load()}catch(x){setError((x as Error).message)}};
 return <Guard><Shell title={title} subtitle={subtitle}><div className="toolbar"><input className="input" value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Search ${title.toLowerCase()}…`}/>{fields.length>0&&<button className="btn" onClick={()=>setShow(v=>!v)}>{show?"Cancel":"Add new"}</button>}</div>{show&&<form className="card form-grid" onSubmit={submit}><h2 style={{gridColumn:"1/-1"}}>Add {title.replace(/s$/,'').toLowerCase()}</h2>{fields.map(f=><label key={f.name}>{f.label}{f.type==="textarea"?<textarea className="input" rows={3} required={f.required} value={form[f.name]??""} onChange={e=>setForm({...form,[f.name]:e.target.value})}/>:f.type==="select"?<select className="input" required={f.required} value={form[f.name]??""} onChange={e=>setForm({...form,[f.name]:e.target.value})}><option value="">Select…</option>{f.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:f.type==="checkbox"?<input type="checkbox" checked={!!form[f.name]} onChange={e=>setForm({...form,[f.name]:e.target.checked})}/>:<input className="input" type={f.type??"text"} required={f.required} value={form[f.name]??""} onChange={e=>setForm({...form,[f.name]:e.target.value})}/>}</label>)}<button className="btn" style={{alignSelf:"end"}}>Save</button></form>}{error&&<p className="error">{error}</p>}<div className="card">{loading?<div className="empty">Loading…</div>:filtered.length?<table><thead><tr>{columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{filtered.map((r,i)=><tr key={r.id??i}>{columns.map(c=><td key={c.key}>{typeof read(r,c.key)==="boolean"?(read(r,c.key)?"Yes":"No"):String(read(r,c.key)??"—")}</td>)}</tr>)}</tbody></table>:<div className="empty"><h2>{query?"No matching results":`No ${title.toLowerCase()} yet`}</h2><p>{query?"Try a different search.":"Create the first record when you’re ready."}</p></div>}</div></Shell></Guard>
}
