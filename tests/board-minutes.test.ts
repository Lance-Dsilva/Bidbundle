import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";
const state=vi.hoisted(()=>({viewer:vi.fn(),comments:vi.fn()}));
vi.mock("@/lib/server/board-review",()=>({requireBoardViewer:state.viewer}));
vi.mock("@/lib/server/db",()=>({db:{boardDiscussionMessage:{findMany:state.comments}}}));
beforeEach(()=>{vi.resetAllMocks();state.viewer.mockResolvedValue({canManage:false});});
vi.mock("@/lib/server/hoa",()=>({HoaWorkflowError:class extends Error{constructor(message:string,readonly status=400){super(message);}}}));
import { renderBoardMinutes } from "@/lib/server/board-minutes";
import { boardView } from "./fixtures/board/view";
afterEach(()=>vi.restoreAllMocks());
describe("private board minutes PDF",()=>{
 it("renders a real PDF using only the selected snapshot and no credential IDs",async()=>{
  const view=boardView();const other=structuredClone(view.rounds[0]);other.id="other-round";other.comments[0].body="UNRELATED_ROUND_PRIVATE_TEXT";view.rounds.push(other);
  view.proposals=structuredClone(view.proposals);view.proposals[0].scope="LIVE_CHANGED_TERMS_NOT_THIS_SNAPSHOT";
  const text=vi.spyOn(PDFDocument.prototype,"text");const bytes=await renderBoardMinutes(view,"round-1");
  expect(Buffer.from(bytes).subarray(0,5).toString()).toBe("%PDF-");expect(bytes.byteLength).toBeGreaterThan(2000);
  const content=text.mock.calls.map(args=>args[0]).join("\n");
  for(const expected of ["Zoë García","李明","Clear Water Services","Monthly cleaning and chemistry","Clear scope and insured","Compare repair exclusions","No award is recorded"])expect(content).toContain(expected);
  for(const hidden of ["UNRELATED_ROUND_PRIVATE_TEXT","LIVE_CHANGED_TERMS_NOT_THIS_SNAPSHOT","PRIVATE_LICENSE_ASSET_ID","PRIVATE_INSURANCE_ASSET_ID"])expect(content).not.toContain(hidden);
 });
 it("rejects a round outside the authorized request before constructing a PDF",async()=>{const text=vi.spyOn(PDFDocument.prototype,"text");await expect(renderBoardMinutes(boardView(),"foreign-round")).rejects.toMatchObject({status:404});expect(text).not.toHaveBeenCalled();});
 it("fails explicitly for unsupported characters instead of silently corrupting names",async()=>{const view=boardView();view.rounds[0].electorate[0].name="Unsupported \u{10FFFF}";await expect(renderBoardMinutes(view,"round-1")).rejects.toMatchObject({status:422});});
 it("paginates long discussion and preserves the final note",async()=>{const view=boardView();view.rounds[0].comments=Array.from({length:35},(_,i)=>({id:`discussion-${i}`,authorUserId:"voter-1",authorName:"Zoë García",body:`Discussion ${i}: ${"Review price, inclusion and contract terms. ".repeat(14)}`,createdAt:"2028-02-03T12:00:00.000Z"}));const text=vi.spyOn(PDFDocument.prototype,"text");const bytes=await renderBoardMinutes(view,"round-1");expect(bytes.byteLength).toBeGreaterThan(5000);const content=text.mock.calls.map(args=>args[0]).join("\n");expect(content).toContain("Discussion 34:");expect(content).toContain("Page 2 of");expect(content).toContain("Check the live review");});
});

describe("complete board discussion export",()=>{
 it("reauthorizes and fetches a complete selected-round discussion when the view was truncated",async()=>{
  const view=boardView();view.rounds[0].commentCount=2;view.rounds[0].commentsTruncated=true;
  state.comments.mockResolvedValue([{id:"full-1",authorUserId:"voter-1",author:{fullName:"Zoë García"},body:"First full record",createdAt:new Date("2028-02-03T00:00:00Z")},{id:"full-2",authorUserId:"voter-2",author:{fullName:"李明"},body:"Last full record beyond interactive page",createdAt:new Date("2028-02-04T00:00:00Z")}]);
  const text=vi.spyOn(PDFDocument.prototype,"text");await renderBoardMinutes(view,"round-1");
  expect(state.viewer).toHaveBeenCalledExactlyOnceWith("voter-1","community-1");
  expect(state.comments).toHaveBeenCalledWith(expect.objectContaining({where:{roundId:"round-1",round:{requestId:"request-1",communityId:"community-1"}},take:1001}));
  const content=text.mock.calls.map(args=>args[0]).join("\n");expect(content).toContain("Last full record beyond interactive page");expect(content).not.toContain("Compare repair exclusions");
 });
 it("refuses a partial official record when the expected full discussion is unavailable",async()=>{const view=boardView();view.rounds[0].commentCount=200;view.rounds[0].commentsTruncated=true;state.comments.mockResolvedValue([]);await expect(renderBoardMinutes(view,"round-1")).rejects.toMatchObject({status:413});});
 it("refuses oversized discussion rather than silently omitting later comments",async()=>{const view=boardView();view.rounds[0].commentCount=1001;view.rounds[0].commentsTruncated=true;state.comments.mockResolvedValue(Array.from({length:1001},()=>({})));await expect(renderBoardMinutes(view,"round-1")).rejects.toMatchObject({status:413});});
 it("does not query private discussion after viewer access has been revoked",async()=>{const view=boardView();view.rounds[0].commentsTruncated=true;state.viewer.mockRejectedValue({status:403});await expect(renderBoardMinutes(view,"round-1")).rejects.toMatchObject({status:403});expect(state.comments).not.toHaveBeenCalled();});
});
