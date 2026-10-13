export const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000";
export async function api<T>(path:string,init?:RequestInit):Promise<T>{
 // Only declare JSON when a body is sent; an empty JSON body used to make POST /auth/logout fail.
 const headers:Record<string,string>={...(init?.body!==undefined?{"Content-Type":"application/json"}:{}),...(init?.headers as Record<string,string>|undefined)};
 const res=await fetch(API+path,{...init,credentials:"include",headers});
 if(!res.ok)throw new Error((await res.json().catch(()=>({}))).error??`Request failed (${res.status})`);
 if(res.status===204)return undefined as T;
 return res.json();
}
