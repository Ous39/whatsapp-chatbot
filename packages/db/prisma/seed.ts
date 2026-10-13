import { PrismaClient, Role, Direction, MessageStatus, KnowledgeStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
const db=new PrismaClient();
const main=async()=>{
 const passwordHash=await bcrypt.hash("OceanBrown123!",12);
 await db.user.upsert({where:{email:"admin@oceanbrown.local"},update:{},create:{email:"admin@oceanbrown.local",name:"OceanBrown Platform Admin",passwordHash,role:Role.SUPER_ADMIN}});
 const business=await db.business.upsert({where:{slug:"oceanbrown-demo"},update:{},create:{name:"OceanBrown Demo",slug:"oceanbrown-demo",industry:"Business Services",timezone:"Africa/Banjul",email:"hello@oceanbrown.example",automationEnabled:false}});
 await db.user.upsert({where:{email:"owner@oceanbrown.local"},update:{businessId:business.id},create:{businessId:business.id,email:"owner@oceanbrown.local",name:"Demo Owner",passwordHash,role:Role.OWNER}});
 const customer=await db.customer.upsert({where:{businessId_phone:{businessId:business.id,phone:"+2205550101"}},update:{},create:{businessId:business.id,phone:"+2205550101",name:"Awa Touray",consent:true,tags:["new-lead"]}});
 const convo=await db.conversation.findFirst({where:{businessId:business.id,customerId:customer.id}}) ?? await db.conversation.create({data:{businessId:business.id,customerId:customer.id,subject:"Website enquiry"}});
 if(await db.message.count({where:{conversationId:convo.id}})===0) await db.message.create({data:{businessId:business.id,conversationId:convo.id,direction:Direction.INBOUND,status:MessageStatus.RECEIVED,body:"Hello, I would like help setting up WhatsApp for my business."}});
 await db.knowledgeSource.upsert({where:{id:"demo-oceanbrown-services"},update:{},create:{id:"demo-oceanbrown-services",businessId:business.id,title:"OceanBrown services",content:"OceanBrown helps businesses set up customer communication, automation, and digital operations. Staff confirm pricing and delivery timelines.",status:KnowledgeStatus.PUBLISHED}});
 console.log("Seeded demo login: owner@oceanbrown.local (password documented in README for local use only)");
}; main().finally(()=>db.$disconnect());
