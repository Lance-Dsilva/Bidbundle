import 'server-only';
import {HoaWorkflowError} from '@/lib/server/hoa';
import {getRecurringPaymentHistory} from '@/lib/server/recurring-payments';
import {RecurringPaymentHistory} from './RecurringPaymentHistory';

export async function RecurringPaymentHistorySection({actorId,planId}:{actorId:string;planId:string}) {
  // Server session supplies actorId; the domain independently checks original ownership.
  try {
    const payments=await getRecurringPaymentHistory(actorId,planId);
    return <RecurringPaymentHistory payments={payments}/>;
  } catch (error) {
    if (error instanceof HoaWorkflowError && (error.status === 403 || error.status === 404)) return null;
    return <section className="bb-card bb-card-pad" aria-label="Recurring payment history">
      <h2 className="text-xl font-semibold">Payment history</h2>
      <p role="status">Payment history is temporarily unavailable. Refresh to try again.</p>
    </section>;
  }
}
