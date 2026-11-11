import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({authorize:vi.fn(),guard:vi.fn(),handler:vi.fn()}));
vi.mock("@/lib/server/auth",()=>({authorizeRequest:state.authorize}));
vi.mock("@/lib/server/auth-guard",()=>({guardHoaMutation:state.guard,guardFailureResponse:(failure:{status:number})=>Response.json({error:"Throttled"},{status:failure.status})}));
vi.mock("@/lib/server/hoa",()=>({HoaWorkflowError:class extends Error{constructor(message:string,readonly status=400){super(message);}}}));
vi.mock("@/lib/server/hoa-api",()=>({hoaErrorResponse:(_scope:string,error:{status?:number})=>Response.json({error:"Request failed"},{status:error.status??500})}));
import { boardRoute } from "@/lib/server/board-api";
function privacy(response:Response){expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("referrer-policy")).toBe("no-referrer");expect(response.headers.get("x-content-type-options")).toBe("nosniff");expect(response.headers.get("x-robots-tag")).toContain("noindex");expect(response.headers.get("vary")).toBe("Cookie, Authorization");}
vi.mock("@/lib/server/board-review",()=>({boardWorkflowError:()=>null}));
const route=boardRoute("test-board",state.handler);
const req=(method="GET",headers:Record<string,string>={})=>new Request("https://bundleen.example/api/board/rounds/round",{method,headers});
beforeEach(()=>{vi.resetAllMocks();state.authorize.mockResolvedValue({ok:true,user:{id:"session-user",email:"member@example.invalid"}});state.guard.mockResolvedValue(null);state.handler.mockResolvedValue(Response.json({ok:true}));});
describe("private board HTTP boundaries",()=>{
 it("returns private anonymous failures before the service or mutation guard",async()=>{state.authorize.mockResolvedValue({ok:false,response:Response.json({error:"Sign in"},{status:401})});const response=await route(req("POST"),undefined);expect(response.status).toBe(401);privacy(response);expect(state.handler).not.toHaveBeenCalled();expect(state.guard).not.toHaveBeenCalled();});
 it.each([{origin:"https://attacker.invalid"},{origin:"null"},{"sec-fetch-site":"cross-site"},{origin:"https://bundleen.example.attacker.invalid"}])("rejects cross-site mutations %j",async headers=>{const response=await route(req("PUT",headers as unknown as Record<string,string>),undefined);expect(response.status).toBe(403);privacy(response);expect(state.handler).not.toHaveBeenCalled();});
 it("uses the session identity and bounded mutation guard",async()=>{const context={roundId:"server-round"};const response=await route(req("PUT",{origin:"https://bundleen.example"}),context);expect(response.status).toBe(200);privacy(response);expect(state.guard).toHaveBeenCalledExactlyOnceWith("session-user");expect(state.handler).toHaveBeenCalledWith(expect.any(Request),context,{id:"session-user",email:"member@example.invalid"});});
 it("does not consume mutation quota for authorized reads",async()=>{const response=await route(req(),undefined);expect(response.status).toBe(200);privacy(response);expect(state.guard).not.toHaveBeenCalled();});
 it("keeps rate-limit failures private and never calls the service",async()=>{state.guard.mockResolvedValue({status:429});const response=await route(req("POST"),undefined);expect(response.status).toBe(429);privacy(response);expect(state.handler).not.toHaveBeenCalled();});
 it("adds privacy headers even to internal exceptions",async()=>{state.handler.mockRejectedValue(new Error("unexpected"));const response=await route(req(),undefined);expect(response.status).toBe(500);privacy(response);});
});
