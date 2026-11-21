import { describe, expect, it } from 'vitest';
import { recurringLineEntitlements, recurringLineRefundBalance, recurringRefundDelta } from '@/lib/recurring-financial-amounts';
describe('recurring line money', () => {
  it('absorbs aggregate rounding instead of reducing any constituent provider share', () => {
    const lines = [5, 5].map(g => recurringLineEntitlements(g, 1000, 500));
    expect(lines.map(l => l.providerCents)).toEqual([5,5]);
    expect(lines.reduce((sum,l) => sum+l.feeCents,0)).toBe(0);
  });
  it('uses cumulative debits and explicitly exposes platform refund roundoff', () => {
    const line = recurringLineEntitlements(1001,1000,500);
    expect([333,666,1000,1001].map(r => { const b=recurringLineRefundBalance(line,r); return [b.providerDebitCents,b.hoaDebitCents]; })).toEqual([[299,16],[599,33],[900,49],[901,50]]);
    expect(recurringLineRefundBalance(line,1000)).toMatchObject({platformNetCents:-1,platformRoundingLiabilityCents:1});
    expect(recurringLineRefundBalance(line,1001)).toMatchObject({remainingGrossCents:0,providerRemainingCents:0,hoaRemainingCents:0,platformNetCents:0});
    expect(recurringRefundDelta(line,333,666)).toEqual({grossCents:333,providerCents:300,hoaCents:17});
  });
  it('preserves remaining provider ninety percent and sums full refund deltas across varied cents', () => {
    for(let g=1;g<=1001;g+=7) {
      const line=recurringLineEntitlements(g,1000,500);
      let p=0,h=0;
      for(let r=1;r<=g;r++) { const d=recurringRefundDelta(line,r-1,r); p+=d.providerCents;h+=d.hoaCents; const b=recurringLineRefundBalance(line,r);expect(b.providerRemainingCents*10).toBeGreaterThanOrEqual(b.remainingGrossCents*9); }
      expect([p,h]).toEqual([line.providerCents,line.hoaCents]);
    }
  });
  it('rejects overflow, excess rates, over-refunds and decreasing totals', () => {
    expect(()=>recurringLineEntitlements(Number.MAX_SAFE_INTEGER+1,1000,500)).toThrow();
    expect(()=>recurringLineEntitlements(100,1001,500)).toThrow();
    expect(()=>recurringLineEntitlements(100,500,501)).toThrow();
    const l=recurringLineEntitlements(100,1000,500);
    expect(()=>recurringLineRefundBalance(l,101)).toThrow();
    expect(()=>recurringRefundDelta(l,50,49)).toThrow();
  });
});
