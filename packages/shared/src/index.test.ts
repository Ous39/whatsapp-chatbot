import { describe, expect, it } from "vitest";
import { can, customerSchema } from "./index";
describe("authorization",()=>{it("keeps agent permissions narrow",()=>{expect(can("AGENT","conversation:reply")).toBe(true);expect(can("AGENT","team:* ")).toBe(false);});});
describe("contact normalization",()=>{it("requires E.164",()=>{expect(customerSchema.safeParse({name:"A",phone:"220123"}).success).toBe(false);});});
