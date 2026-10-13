import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { db } from "@oceanbrown/db";

export function validMetaSignature(raw:Buffer,signature:string|undefined,secret:string|undefined){if(!signature||!secret)return false;const expected="sha256="+crypto.createHmac("sha256",secret).update(raw).digest("hex");return signature.length===expected.length&&crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected));}
export async function registerWebhook(app:FastifyInstance){
 app.get("/webhooks/meta",async(req,reply)=>{const q=req.query as Record<string,string>;if(q["hub.mode"]==="subscribe"&&q["hub.verify_token"]===process.env.META_VERIFY_TOKEN)return reply.type("text/plain").send(q["hub.challenge"]);return reply.code(403).send("Verification failed");});
 app.post("/webhooks/meta",{config:{rawBody:true}},async(req,reply)=>{const raw=(req as typeof req&{rawBody?:Buffer}).rawBody??Buffer.from(JSON.stringify(req.body));if(!validMetaSignature(raw,req.headers["x-hub-signature-256"] as string|undefined,process.env.META_APP_SECRET))return reply.code(401).send({error:"Invalid signature"});const payload=req.body as any;const change=payload?.entry?.[0]?.changes?.[0]?.value;const phoneNumberId=change?.metadata?.phone_number_id;const externalId=change?.messages?.[0]?.id??change?.statuses?.[0]?.id??crypto.createHash("sha256").update(raw).digest("hex");const connection=phoneNumberId?await db.whatsAppConnection.findUnique({where:{phoneNumberId}}):null;await db.webhookEvent.upsert({where:{externalId},update:{},create:{externalId,businessId:connection?.businessId,payload,status:connection?"RECEIVED":"UNMATCHED"}});return reply.code(200).send({received:true});});
}
