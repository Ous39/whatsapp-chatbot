export const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000";
export async function api<T>(path:string,init?:RequestInit):Promise<T>{
 // Only declare JSON when a body is sent; an empty JSON body used to make POST /auth/logout fail.
 const headers:Record<string,string>={...(init?.body!==undefined?{"Content-Type":"application/json"}:{}),...(init?.headers as Record<string,string>|undefined)};
 const res=await fetch(API+path,{...init,credentials:"include",headers});
 if(!res.ok){const body=await res.json().catch(()=>({}));const err=new Error(body.error??`Request failed (${res.status})`) as Error&{details?:string[];status?:number};if(Array.isArray(body.details))err.details=body.details;err.status=res.status;throw err}
 if(res.status===204)return undefined as T;
 return res.json();
}
