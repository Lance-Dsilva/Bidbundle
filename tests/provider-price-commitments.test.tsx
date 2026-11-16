// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderPriceCommitments } from "../src/components/provider/ProviderPriceCommitments";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const proposal={id:"commit-1",scope:"Mow lawns",acceptedAt:null,request:{title:"Group mowing",description:"Two scheduled services",totalOccurrences:2,recurrenceIntervalDays:7,startDate:"2027-01-01T00:00:00Z",enrollmentClosesAt:"2026-12-31T00:00:00Z"},tiers:[{minHomes:1,perHomeCents:10000}]};
it("shows full service terms and explicit acceptance before making an enrollment promise",async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({commitments:[proposal]})}).mockResolvedValueOnce({ok:true,json:async()=>({acceptedAt:"2026-12-01T00:00:00Z"})});vi.stubGlobal("fetch",fetch);
 render(<ProviderPriceCommitments/>);await screen.findByText("Group mowing: group pricing commitment");
 expect(screen.getByText(/2 visits/).textContent).toContain("every 7 days");expect(screen.queryByText(/Residents may enroll/)).toBeNull();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.submit(screen.getByRole("button",{name:"Accept provider commitment"}).closest("form")!);
 await screen.findByText("Accepted. Residents may enroll at these protected prices.");expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({acceptTerms:true}));
});
it("preserves the unaccepted state if server authorization rejects acceptance",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({commitments:[proposal]})}).mockResolvedValueOnce({ok:false,json:async()=>({error:"Active provider account required."})}));render(<ProviderPriceCommitments/>);await screen.findByRole("checkbox");fireEvent.click(screen.getByRole("checkbox"));fireEvent.submit(screen.getByRole("button").closest("form")!);await waitFor(()=>expect(screen.getByRole("alert").textContent).toBe("Active provider account required."));expect(screen.queryByText(/Residents may enroll/)).toBeNull();
});
