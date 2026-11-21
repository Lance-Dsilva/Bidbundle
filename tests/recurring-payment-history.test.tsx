// @vitest-environment jsdom
import {afterEach, expect, it} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import {RecurringPaymentHistory, type RecurringPaymentSummary} from '@/components/recurring-plans/RecurringPaymentHistory';
afterEach(cleanup);
const payment: RecurringPaymentSummary = {id:'private-charge-id',sourceKind:'monthly',localMonth:'2026-11',status:'succeeded',amountCents:1001,currency:'usd',refundedCents:1000,providerNetCents:null,holdReason:null,lines:[{visitId:'private-visit-id',localDate:'2026-11-05',grossCents:1001,refundedCents:1000}]};
it('shows aggregate and constituent refunds without leaking identifiers or provider fields',()=>{
 const {container}=render(<RecurringPaymentHistory payments={[payment]}/>);
 expect(screen.getByText('Paid')).toBeTruthy();
 expect(screen.getByText('Service total')).toBeTruthy();
 expect(screen.getByText('2026-11-05')).toBeTruthy();
 expect(container.textContent).toContain('$10.01');
 expect(container.textContent).toContain('$10.00');
 expect(container.textContent).not.toContain('private-');
 expect(screen.queryByText('Provider share after refunds')).toBeNull();
});
it('does not represent provider entitlement as a completed payout',()=>{
 render(<RecurringPaymentHistory payments={[{...payment,providerNetCents:1}]}/>);
 expect(screen.getByText('$0.01')).toBeTruthy();
 expect(screen.getByText(/not confirmation that a payout/)).toBeTruthy();
});
it('prioritizes reconciliation holds and does not expose raw reasons',()=>{
 const {container}=render(<RecurringPaymentHistory payments={[{...payment,holdReason:'internal_processor_mismatch'}]}/>);
 expect(screen.getByText('Billing review needed')).toBeTruthy();
 expect(screen.queryByText('Paid')).toBeNull();
 expect(container.textContent).not.toContain('internal_processor_mismatch');
});
it('explains empty history without implying a card setup charge',()=>{
 render(<RecurringPaymentHistory payments={[]}/>);
 expect(screen.getByText(/Saving a card does not create a charge/)).toBeTruthy();
});

it('labels partial refunds and canceled payments without implying ongoing processing',()=>{
 render(<RecurringPaymentHistory payments={[{...payment,status:'partially_refunded'}, {...payment,id:'canceled',status:'canceled'}]}/>);
 expect(screen.getByText('Partially refunded')).toBeTruthy();
 expect(screen.getByText('Payment canceled')).toBeTruthy();
});
it('does not guess that an unknown status means payment processing',()=>{
 render(<RecurringPaymentHistory payments={[{...payment,status:'future_state'}]}/>);
 expect(screen.getByText('Payment status unavailable')).toBeTruthy();
 expect(screen.queryByText('Payment processing')).toBeNull();
});
