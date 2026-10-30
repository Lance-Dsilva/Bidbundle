import "server-only";

import { HoaWorkflowError } from "@/lib/server/hoa";

/** Actionable refusal that exposes no address or coordinates to other residents. */
export class HomeAddressRequiredError extends HoaWorkflowError {
  constructor() {
    super("Add and confirm your home address before joining this request.", 409);
    this.name = "HomeAddressRequiredError";
  }
}
