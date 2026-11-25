import "server-only";
export class VendorSourcingError extends Error {
  constructor(message: string, readonly status = 409) { super(message); this.name = "VendorSourcingError"; }
}
