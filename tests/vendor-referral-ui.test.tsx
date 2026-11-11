// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VendorReferralForm } from "@/components/vendors/VendorReferralForm";

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fill() {
  render(<VendorReferralForm requestId="request-59" />);
  fireEvent.click(screen.getByText("Recommend your current service provider"));
  fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Synthetic Pool Care" } });
  fireEvent.change(screen.getByLabelText("Business email"), { target: { value: "pool@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Note for the team"), { target: { value: "Our existing business contact" } });
  return screen.getByLabelText("Business name").closest("form")!;
}
describe("resident and manager referral review handoff", () => {
  it("saves a business contact for review without inventing verification or sending an invitation", async () => {
    fetchMock.mockResolvedValue(Response.json({ recorded: true }, { status: 201 }));
    fireEvent.submit(fill());
    expect(await screen.findByRole("status")).toHaveTextContent("No invitation has been sent");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/hoa/requests/request-59/vendor-referrals");
    expect(options).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(options.body)).toEqual({ businessName: "Synthetic Pool Care", email: "pool@example.invalid", phone: null, notes: "Our existing business contact" });
    expect(screen.getByLabelText("Business name")).toHaveValue("");
  });
  it("prevents a second submission while the first is waiting", async () => {
    let resolve!: (response: Response) => void; fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const form = fill(); fireEvent.submit(form); fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => resolve(Response.json({ recorded: true }, { status: 201 })));
    expect(await screen.findByRole("status")).toHaveTextContent("saved for review");
  });
  it("shows an authorization failure while retaining the contact for correction", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "This request is not available to your account." }, { status: 403 }));
    fireEvent.submit(fill());
    expect(await screen.findByRole("alert")).toHaveTextContent("not available to your account");
    expect(screen.queryByRole("status")).not.toBeInTheDocument(); expect(screen.getByLabelText("Business email")).toHaveValue("pool@example.invalid");
    expect(screen.getByRole("button", { name: "Save provider referral" })).toBeEnabled();
  });
  it("does not present a failed network request as a saved referral", async () => {
    fetchMock.mockRejectedValue(new Error("Connection lost.")); fireEvent.submit(fill());
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost"); expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
