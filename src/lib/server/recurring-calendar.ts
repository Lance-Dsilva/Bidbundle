import "server-only";
import { addDaysToDateKey, daysBetweenDateKeys, isSupportedTimeZone, parseDateKey, zonedDateKey, zonedToUtc } from "@/lib/server/timezone";
export const RECURRING_NOTICE_DAYS = 30;
export function recurringNoticeDate(timezone: string, now = new Date()) {
  if (!isSupportedTimeZone(timezone)) throw new Error("Invalid plan timezone");
  return addDaysToDateKey(zonedDateKey(now, timezone), RECURRING_NOTICE_DAYS);
}
export function recurringMonthBounds(month: string, timezone: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !isSupportedTimeZone(timezone)) throw new Error("Invalid billing month or timezone");
  const [year, m] = month.split("-").map(Number);
  if (year < 2020 || year > 2200) throw new Error("Unsupported billing year");
  const next = new Date(Date.UTC(year, m, 1));
  return { first: `${month}-01`, next: next.toISOString().slice(0, 10), startInstant: zonedToUtc(year,m,1,0,timezone).instant,
    endInstant: zonedToUtc(next.getUTCFullYear(),next.getUTCMonth()+1,1,0,timezone).instant };
}
/** Denominator includes all cadence dates, including before join/after pause. */
export function recurringMonthSchedule(input: { anchorDate: string; cadenceDays: number; monthlyPriceCents: number; timezone: string }, month: string) {
  if (!parseDateKey(input.anchorDate) || !Number.isInteger(input.cadenceDays) || input.cadenceDays < 1 || input.cadenceDays > 31 || !Number.isSafeInteger(input.monthlyPriceCents) || input.monthlyPriceCents < 50) throw new Error("Invalid recurring schedule");
  const bounds = recurringMonthBounds(month,input.timezone); const delta = daysBetweenDateKeys(input.anchorDate,bounds.first);
  let date = addDaysToDateKey(input.anchorDate,Math.ceil(delta/input.cadenceDays)*input.cadenceDays);
  const dates: string[] = []; while (date < bounds.next) { dates.push(date); date=addDaysToDateKey(date,input.cadenceDays); }
  return dates.map((localDate,index)=>{const p=parseDateKey(localDate)!;return {localDate,serviceDate:zonedToUtc(p.year,p.month,p.day,720,input.timezone).instant,
    allocatedCents:Math.floor(input.monthlyPriceCents/dates.length)+(index<input.monthlyPriceCents%dates.length?1:0)};});
}
