import type { Tone } from "@/components/admin/primitives";
import type {
  SupportTicketPriorityValue,
  SupportTicketStatusValue,
  SupportTicketCategoryValue,
} from "@/lib/validation/support";

/**
 * How support values are rendered.
 *
 * Shared between the queue, the detail page, and the customer support centre so
 * a status never reads one way in the list and another way on the record.
 */

export const STATUS_LABELS: Record<SupportTicketStatusValue, string> = {
  new: "New",
  open: "Open",
  pending_customer: "Waiting on customer",
  pending_internal: "Working on it",
  resolved: "Resolved",
  closed: "Closed",
};

/** What the *customer* is told. Internal working states are not their problem. */
export const CUSTOMER_STATUS_LABELS: Record<SupportTicketStatusValue, string> = {
  new: "Received",
  open: "With our team",
  pending_customer: "Waiting on you",
  pending_internal: "With our team",
  resolved: "Resolved",
  closed: "Closed",
};

export const STATUS_TONES: Record<SupportTicketStatusValue, Tone> = {
  new: "info",
  open: "accent",
  pending_customer: "warning",
  pending_internal: "accent",
  resolved: "positive",
  closed: "neutral",
};

export const PRIORITY_LABELS: Record<SupportTicketPriorityValue, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_TONES: Record<SupportTicketPriorityValue, Tone> = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
  urgent: "danger",
};

export const CATEGORY_LABELS: Record<SupportTicketCategoryValue, string> = {
  account: "Account & sign-in",
  billing: "Billing",
  service_request: "Service request",
  bidding: "Bids & awards",
  scheduling: "Scheduling & visits",
  provider_issue: "Provider issue",
  community: "Community & HOA",
  technical: "Something is broken",
  other: "Something else",
};

export const EVENT_LABELS: Record<string, string> = {
  created: "opened the ticket",
  status_changed: "changed the status",
  priority_changed: "changed the priority",
  assigned: "assigned the ticket",
  unassigned: "removed the assignee",
  customer_replied: "replied",
  admin_replied: "replied to the customer",
  internal_note_added: "added an internal note",
  reopened: "reopened the ticket",
  ai_draft_generated: "generated an AI reply draft",
  ai_draft_approved: "approved and sent an AI-assisted reply",
  ai_draft_discarded: "discarded an AI reply draft",
  ai_explanation_generated: "generated an internal AI explanation",
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? "updated the ticket";
}

/** Option lists for the filter and edit controls. */
export function optionsFrom<T extends string>(labels: Record<T, string>) {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}
