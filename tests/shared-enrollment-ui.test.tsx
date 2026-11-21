// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({refresh:vi.fn(),fetch:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:m.refresh})}));
vi.mock("@/components/billing/EnrollmentBilling",()=>({EnrollmentBilling:()=> <div>Billing consent</div>}));
import {SharedEnrollment} from "@/components/sharing/SharedEnrollment";
const state={stage:"address" as const,requestPath:"/c/community/r/request",service:"Pool service",ownAddress:{addressLine1:"12 Test St",locality:"Testville",region:"TX",postalCode:"75001"}};
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal("fetch",m.fetch)});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it("submits only typed address to the bound flow and waits for authoritative state",async()=>{
 m.fetch.mockResolvedValue({ok:true,json:async()=>({stage:"card"})});render(<SharedEnrollment token="flow" state={state}/>);
 fireEvent.click(screen.getByRole("button",{name:"Confirm my home"}));
 await vi.waitFor(()=>expect(m.refresh).toHaveBeenCalledTimes(1));
 expect(m.fetch.mock.calls[0][0]).toBe("/api/public-enrollment/flow");
 expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual({action:"address",address:{...state.ownAddress,unitLabel:""}});
 expect(screen.queryByText("Billing consent")).toBeNull();
});
it("shows manager review without presenting card setup or an enrolled claim",()=>{
 render(<SharedEnrollment token="flow" state={{...state,stage:"review"}}/>);
 expect(screen.getByRole("status")).toHaveTextContent("community manager");expect(screen.queryByText("Billing consent")).toBeNull();expect(screen.queryByText(/You’re enrolled/)).toBeNull();
});
it("does not advance after address authorization is denied",async()=>{
 m.fetch.mockResolvedValue({ok:false,json:async()=>({error:"Ask your manager to confirm your invitation."})});render(<SharedEnrollment token="flow" state={state}/>);
 fireEvent.click(screen.getByRole("button",{name:"Confirm my home"}));expect(await screen.findByRole("alert")).toHaveTextContent("manager");expect(m.refresh).not.toHaveBeenCalled();
});

it("retains manager-review guidance returned by address matching",async()=>{
 m.fetch.mockResolvedValue({ok:true,json:async()=>({stage:"review"})});render(<SharedEnrollment token="flow" state={state}/>);
 fireEvent.click(screen.getByRole("button",{name:"Confirm my home"}));expect(await screen.findByRole("status")).toHaveTextContent("community manager");expect(screen.queryByRole("button",{name:"Confirm my home"})).toBeNull();expect(m.refresh).not.toHaveBeenCalled();
});
