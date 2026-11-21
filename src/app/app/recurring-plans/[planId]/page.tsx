import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireUser} from '@/lib/server/auth';
import {getRecurringPlanView} from '@/lib/server/recurring-plans';
import {RecurringPaymentHistorySection} from '@/components/recurring-plans/RecurringPaymentHistorySection';
import {RecurringPlanPanel} from '@/components/recurring-plans/RecurringPlanPanel';
export default async function RecurringPlanPage({params}:{params:Promise<{planId:string}>}){const {planId}=await params;const user=await requireUser(`/app/recurring-plans/${encodeURIComponent(planId)}`);if(process.env.RECURRING_PLANS!=='1')notFound();const plan=await getRecurringPlanView(user.id,planId);return <main className="mx-auto max-w-3xl p-4 sm:p-8 space-y-5"><Link href="/app/recurring-plans" className="underline">All recurring services</Link><RecurringPlanPanel key={plan.id} initial={plan}/>{process.env.RECURRING_TEST_PAYMENTS==='1'&&process.env.STRIPE_TEST_PAYMENTS==='1'&&plan.canViewPaymentHistory&&<RecurringPaymentHistorySection actorId={user.id} planId={plan.id}/>}</main>;}
