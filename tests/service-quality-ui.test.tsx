// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ServiceQualityReport } from "@/components/hoa/ServiceQualityReport";
import { QualityResolutionForm } from "@/components/hoa/QualityResolutionForm";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("preserves the report text when the server rejects an expired window", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Report within 72 hours." }) }); vi.stubGlobal("fetch", fetch);
  render(<ServiceQualityReport visitId="visit-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
  fireEvent.change(screen.getByLabelText("What went wrong?"), { target: { value: "The cleaning was incomplete." } });
  fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("What went wrong?") as HTMLTextAreaElement).value).toBe("The cleaning was incomplete.");
  expect(screen.queryByText(/Your report is saved/)).toBeNull();
});

it("submits only the resident's report fields and shows the support follow-up", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "claim", photos: [] }) }); vi.stubGlobal("fetch", fetch);
  render(<ServiceQualityReport visitId="visit-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
  fireEvent.change(screen.getByLabelText("What went wrong?"), { target: { value: "The cleaning was incomplete." } });
  fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
  await screen.findByRole("status");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ reason: "incomplete", description: "The cleaning was incomplete." });
  expect(screen.getByRole("link", { name: "Support" }).getAttribute("href")).toBe("/app/support");
});

it("does not describe a pending resolution request as an executed refund", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ resolution: "refund_pending", executed: false }) }); vi.stubGlobal("fetch", fetch);
  render(<QualityResolutionForm claimId="claim" />);
  fireEvent.change(screen.getByLabelText("Requested resolution"), { target: { value: "request_refund" } });
  fireEvent.change(screen.getByLabelText("Internal reason"), { target: { value: "The agreed service was not completed." } });
  fireEvent.click(screen.getByRole("button", { name: "Record pending resolution" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("No refund or redo has been executed"));
});
