import { describe,expect,it,vi } from "vitest";
import crypto from "node:crypto";
vi.mock("@oceanbrown/db",()=>({db:{knowledgeSource:{findMany:vi.fn().mockResolvedValue([{id:"1",title:"Opening hours",content:"We open Monday to Friday from 9am to 5pm."}])}}}));
import { simulateReply } from "../src/simulator";
import { validMetaSignature } from "../src/webhook";
describe("simulator",()=>{it("uses published knowledge",async()=>{const r=await simulateReply("tenant","When do you open?");expect(r.simulated).toBe(true);expect(r.sources[0]?.title).toBe("Opening hours");});it("hands complaints to people",async()=>{expect((await simulateReply("t","I need a human for a complaint")).action).toBe("HANDOVER");});});
describe("webhook security",()=>{it("accepts only the matching raw-body signature",()=>{const body=Buffer.from('{"event":"test"}'),secret="test-secret",signature="sha256="+crypto.createHmac("sha256",secret).update(body).digest("hex");expect(validMetaSignature(body,signature,secret)).toBe(true);expect(validMetaSignature(body,signature,"wrong")).toBe(false)});});
