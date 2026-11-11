import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({candidates:vi.fn(),claim:vi.fn(),update:vi.fn(),reminder:vi.fn(),email:vi.fn()}));
vi.mock("@/lib/server/db",()=>({db:{outboxEvent:{findMany:state.candidates,updateMany:state.claim,update:state.update}}}));
vi.mock("@/lib/server/board-review",()=>({resolveBoardReminder:state.reminder}));
vi.mock("@/lib/server/email",()=>({getEmailProvider:()=>({send:state.email})}));
vi.mock("next/server",()=>({after:vi.fn()}));
import { deliverPendingOutbox } from "@/lib/server/notifications";
beforeEach(()=>{vi.resetAllMocks();state.claim.mockResolvedValue({count:1});state.update.mockResolvedValue({});state.candidates.mockResolvedValue([{id:"outbox-board",kind:"board_vote_reminder",dedupeKey:"board-reminder:round:user",payload:{roundId:"round",userId:"user"},attempts:0}]);});
describe("board reminder worker",()=>{
 it.each(["sent","skipped"])("marks %s resolution terminal without ordinary email transport",async kind=>{state.reminder.mockResolvedValue({kind});expect(await deliverPendingOutbox()).toEqual({claimed:1,delivered:1,failed:0});expect(state.reminder).toHaveBeenCalledExactlyOnceWith({roundId:"round",userId:"user"});expect(state.email).not.toHaveBeenCalled();expect(state.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:"outbox-board"},data:expect.objectContaining({status:"delivered",lastError:null})}));});
 it("retains transient infrastructure failures for retry instead of dropping the reminder",async()=>{state.reminder.mockRejectedValue(new Error("Synthetic database unavailable"));expect(await deliverPendingOutbox()).toEqual({claimed:1,delivered:0,failed:1});expect(state.update).toHaveBeenCalledWith({where:{id:"outbox-board"},data:{lastError:"Synthetic database unavailable"}});expect(state.update.mock.calls.some(([input])=>input.data.status==="delivered")).toBe(false);expect(state.email).not.toHaveBeenCalled();});
 it("does not deliver reminders already claimed by a concurrent worker",async()=>{state.claim.mockResolvedValue({count:0});expect(await deliverPendingOutbox()).toEqual({claimed:0,delivered:0,failed:0});expect(state.reminder).not.toHaveBeenCalled();});
});
