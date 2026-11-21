import { expect, it } from "vitest";
import { incrementalProviderReversal } from "@/lib/stripe-refund-amounts";
it("conserves the exact provider share across small partial refunds", () => {
  let sum = 0;
  for (let before = 0; before < 101; before++) sum += incrementalProviderReversal(101, 91, before, 1);
  expect(sum).toBe(91);
  expect(incrementalProviderReversal(101, 91, 100, 1)).toBe(1);
});
it("full refund reverses the entire frozen provider share", () => {
  expect(incrementalProviderReversal(10000, 9000, 0, 10000)).toBe(9000);
  expect(incrementalProviderReversal(10000, 9000, 5000, 5000)).toBe(4500);
});
it.each([[100,90,99,2],[100,101,0,10],[0,0,0,1],[100,90,0,0],[100,90,-1,1],[100,90,0,1.5]])("rejects invalid allocations %j", (...args) => {
  expect(() => incrementalProviderReversal(...args as [number,number,number,number])).toThrow();
});
