import { db } from "@oceanbrown/db";

export type SimulationResult={text:string;sources:{id:string;title:string}[];action:"ANSWER"|"CLARIFY"|"HANDOVER";simulated:true};
const words=(s:string)=>new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(x=>x.length>2));
export async function simulateReply(businessId:string,input:string):Promise<SimulationResult>{
 const q=words(input);const sources=await db.knowledgeSource.findMany({where:{businessId,status:"PUBLISHED"},select:{id:true,title:true,content:true}});
 const ranked=sources.map(s=>({s,score:[...words(s.title+" "+s.content)].filter(w=>q.has(w)).length})).sort((a,b)=>b.score-a.score);
 if(/\b(human|person|agent|complaint|angry|refund)\b/i.test(input)) return {text:"I’ll hand this conversation to a team member. No live message has been sent—this is the local simulator.",sources:[],action:"HANDOVER",simulated:true};
 const top=ranked[0];if(!top||top.score===0)return {text:"I don’t have approved information for that yet. Could you share a little more detail, or would you like a human team member?",sources:[],action:"CLARIFY",simulated:true};
 const excerpt=top.s.content.length>350?top.s.content.slice(0,347)+"...":top.s.content;
 return {text:`Based on the approved ${top.s.title}: ${excerpt}`,sources:[{id:top.s.id,title:top.s.title}],action:"ANSWER",simulated:true};
}
