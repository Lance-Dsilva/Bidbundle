// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { useNeighbourhood } from "@/hooks/useNeighbourhood";
const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), apiFetch: state.api }));
const hub = { communityId: "hood", communityName: "Oakwood", isManager: false, managerName: null, activeNeighbourCount: 2, addressReady: false, requests: [] };
const join = { kind: "respond", requestId: "request-exact", response: "joined" } as const;
beforeEach(() => { state.api.mockReset().mockResolvedValue({ hub }); });
afterEach(cleanup);
async function load(addressReady = false) {
  state.api.mockResolvedValueOnce({ hub: { ...hub, addressReady } });
  const rendered = renderHook(() => useNeighbourhood());
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

describe("address-gated neighborhood action", () => {
  it("opens completion immediately without posting Join and cancels without mutations", async () => {
    const { result } = await load();
    await act(async () => { expect(await result.current.act(join)).toBe(false); });
    expect(result.current.addressRequiredRequestId).toBe("request-exact"); expect(state.api).toHaveBeenCalledOnce();
    act(() => result.current.cancelAddress()); expect(result.current.addressRequiredRequestId).toBeNull(); expect(state.api).toHaveBeenCalledOnce();
  });

  it("recognizes a structured server refusal when loaded readiness was stale", async () => {
    const { result } = await load(true);
    state.api.mockRejectedValueOnce(new ApiError(409, "Address required", undefined, { code: "HOME_ADDRESS_REQUIRED", addressRequired: true }));
    await act(async () => { expect(await result.current.act(join)).toBe(false); });
    expect(result.current.addressRequiredRequestId).toBe("request-exact"); expect(result.current.error).toBeNull();
  });

  it("retries the exact pending request after profile completion, then reloads server state", async () => {
    const { result } = await load(); await act(async () => { await result.current.act(join); });
    state.api.mockResolvedValueOnce({ response: "joined" }).mockResolvedValueOnce({ hub: { ...hub, addressReady: true } });
    await act(async () => { await result.current.resumeJoin(); });
    expect(state.api.mock.calls[1]).toEqual(["/homeowner/requests/request-exact/participation", { method: "POST", body: JSON.stringify({ response: "joined" }) }]);
    expect(state.api.mock.calls[2][0]).toBe("/homeowner/neighbourhood"); expect(result.current.addressRequiredRequestId).toBeNull(); expect(result.current.hub?.addressReady).toBe(true);
  });

  it("propagates post-save expiry denial instead of marking the request joined", async () => {
    const { result } = await load(); await act(async () => { await result.current.act(join); });
    const denial = new ApiError(409, "Sign-ups closed"); state.api.mockRejectedValueOnce(denial);
    await act(async () => { await expect(result.current.resumeJoin()).rejects.toBe(denial); });
    expect(result.current.addressRequiredRequestId).toBe("request-exact"); expect(result.current.hub?.addressReady).toBe(false); expect(state.api).toHaveBeenCalledTimes(2);
  });

  it("leaves decline available without an address and keeps other 409 failures visible", async () => {
    const { result } = await load(); state.api.mockRejectedValueOnce(new ApiError(409, "Request locked"));
    await act(async () => { await result.current.act({ ...join, response: "declined" }); });
    expect(result.current.error).toBe("Request locked"); expect(result.current.addressRequiredRequestId).toBeNull();
    expect(state.api.mock.calls[1][1].body).toBe(JSON.stringify({ response: "declined" }));
  });
});
