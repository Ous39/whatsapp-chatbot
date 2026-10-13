import { Worker } from "bullmq";import IORedis from "ioredis";import { db } from "@oceanbrown/db";
const connection=new IORedis(process.env.REDIS_URL??"redis://localhost:6379",{maxRetriesPerRequest:null});
const worker=new Worker("oceanbrown-events",async job=>{
 if(job.name==="process-webhook"){
  const event=await db.webhookEvent.findUnique({where:{id:job.data.eventId}});if(!event||event.status==="PROCESSED")return;
  // The receiver persists before acknowledgement. Provider-specific parsing belongs here.
  await db.webhookEvent.update({where:{id:event.id},data:{status:"PROCESSED",processedAt:new Date()}});
 }
 if(job.name==="cancel-ai-reply") return {cancelled:true,conversationId:job.data.conversationId};
},{connection,concurrency:10});
worker.on("failed",(job,error)=>console.error(JSON.stringify({level:"error",event:"job.failed",jobId:job?.id,reason:error.message})));
worker.on("stalled",id=>console.error(JSON.stringify({level:"warn",event:"job.stalled",jobId:id})));
console.log(JSON.stringify({level:"info",event:"worker.ready",provider:"simulator"}));
const stop=async()=>{await worker.close();await connection.quit();await db.$disconnect();process.exit(0)};process.on("SIGTERM",stop);process.on("SIGINT",stop);
