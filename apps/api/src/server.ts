import Fastify from "fastify";
import cors from "@fastify/cors";import cookie from "@fastify/cookie";import jwt from "@fastify/jwt";import helmet from "@fastify/helmet";import rateLimit from "@fastify/rate-limit";
import { registerAuth } from "./auth.js";import { registerRoutes } from "./routes.js";import { registerWebhook } from "./webhook.js";
const app=Fastify({logger:{redact:["req.headers.authorization","req.headers.cookie","*.accessToken","*.password"]},bodyLimit:1024*1024});
await app.register(cors,{origin:process.env.APP_URL??"http://localhost:3000",credentials:true});await app.register(cookie);await app.register(jwt,{secret:process.env.JWT_SECRET??"local-development-secret-change-before-deploy",cookie:{cookieName:"ob_session",signed:false}});await app.register(helmet);await app.register(rateLimit,{max:200,timeWindow:"1 minute"});
app.addContentTypeParser("application/json",{parseAs:"buffer"},(req,body,done)=>{try{(req as typeof req&{rawBody:Buffer}).rawBody=body as Buffer;done(null,JSON.parse((body as Buffer).toString("utf8")))}catch(error){done(error as Error,undefined)}});
await registerAuth(app);await registerRoutes(app);await registerWebhook(app);
app.setErrorHandler((error,_req,reply)=>{const err=error as Error&{statusCode?:number};app.log.error(err);reply.code(err.statusCode??500).send({error:err.statusCode&&err.statusCode<500?err.message:"Internal server error"});});
await app.listen({port:Number(process.env.PORT??4000),host:"0.0.0.0"});
