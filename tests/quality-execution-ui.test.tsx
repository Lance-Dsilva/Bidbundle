// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { QualityExecutionForm } from "@/components/hoa/QualityExecutionForm";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps an approved refund operation identity and does not call reversal pending complete", async () => {
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({resolution:"refund_pending",executed:false})});vi.stubGlobal("fetch",fetch);
 render(<QualityExecutionForm claimId="claim" resolution="refund_pending" operationId="approved" amountCents={400}/>);
 fireEvent.change(screen.getByLabelText("Approval note"),{target:{value:"Retry agreed compensation"}});
 fireEvent.click(screen.getByRole("button",{name:"Retry approved refund"}));
 expect((await screen.findByRole("status")).textContent).toContain("remains pending");
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({operationId:"approved",amountCents:400});
});
it("retains generated identity after lost response and suppresses double submit", async()=>{
 let reject!: (e:Error)=>void; const fetch=vi.fn().mockImplementationOnce(()=>new Promise((_r,j)=>{reject=j})).mockResolvedValue({ok:true,json:async()=>({executed:true})});vi.stubGlobal("fetch",fetch);
 render(<QualityExecutionForm claimId="claim" resolution="refund_pending" operationId={null} amountCents={null}/>);
 fireEvent.change(screen.getByLabelText("Refund amount (USD)"),{target:{value:"3.33"}});fireEvent.change(screen.getByLabelText("Approval note"),{target:{value:"Agreed partial compensation"}});
 const form=screen.getByRole("button",{name:"Execute approved refund"}).closest("form")!;
 fireEvent.submit(form);fireEvent.submit(form);expect(fetch).toHaveBeenCalledTimes(1);reject(new Error("Lost response"));await screen.findByText("Lost response");fireEvent.submit(form);await screen.findByText("The refund and required reversal are complete.");
 const first=JSON.parse(fetch.mock.calls[0][1].body),second=JSON.parse(fetch.mock.calls[1][1].body);expect(first.operationId).toBe(second.operationId);expect(first.amountCents).toBe(333);
});
