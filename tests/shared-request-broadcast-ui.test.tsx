// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {SharedRequestBroadcast} from "@/components/sharing/SharedRequestBroadcast";
const fetcher=vi.fn();const preview={enabled:true,recipientCount:3,emailCount:2,subject:"Community service",body:"Review this service",previewToken:"snapshot"};
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal("fetch",fetcher)});afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it("requires preview and explicit confirmation, then reports queued rather than delivered",async()=>{
 fetcher.mockResolvedValueOnce({ok:true,json:async()=>preview}).mockResolvedValueOnce({ok:true,json:async()=>({queued:true,recipientCount:3,emailCount:2})});
 render(<SharedRequestBroadcast requestId="request"/>);fireEvent.click(screen.getByRole("button",{name:"Email residents"}));await screen.findByRole("region",{name:"Resident message preview"});
 expect(screen.getByRole("button",{name:"Queue resident message"})).toBeDisabled();expect(fetcher).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Queue resident message"}));expect(await screen.findByRole("status")).toHaveTextContent("Delivery is not yet confirmed");
 expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({action:"send",previewToken:"snapshot"});
});
it("does not offer sending when environment email is disabled",async()=>{
 fetcher.mockResolvedValue({ok:true,json:async()=>({...preview,enabled:false})});render(<SharedRequestBroadcast requestId="request"/>);fireEvent.click(screen.getByRole("button",{name:"Email residents"}));expect(await screen.findByRole("status")).toHaveTextContent("not configured");expect(screen.queryByRole("checkbox")).toBeNull();
});
