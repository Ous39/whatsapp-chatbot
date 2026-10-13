export const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000";
export async function api<T>(path:string,init?:RequestInit):Promise<T>{const res=await fetch(API+path,{...init,credentials:"include",headers:{"Content-Type":"application/json",...init?.headers}});if(!res.ok)throw new Error((await res.json().catch(()=>({}))).error??`Request failed (${res.status})`);return res.json();}
