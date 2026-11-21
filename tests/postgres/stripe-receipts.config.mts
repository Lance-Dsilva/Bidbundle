import { BaseSequencer, type TestSpecification } from "vitest/node";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
const raw=process.env.TEST_DATABASE_URL;if(!raw)throw new Error("Explicit owned receipt DB required");
const target=new URL(raw);
if(target.protocol!=="postgresql:"||target.hostname!=="127.0.0.1"||target.port!=="53952"||target.pathname!=="/bundleen_issue43_test_receipts"||target.username!=="bundleen_issue43_runner_cards"||!target.password||target.search||target.hash)throw new Error("Only owned isolated receipt DB allowed");
process.env.DATABASE_URL=raw;delete process.env.DIRECT_URL;
process.env.SERVICE_QUALITY_INTAKE="1";process.env.RATE_LIMIT_IDENTIFIER_SECRET="receipt-synthetic-only";process.env.VISIT_PHOTO_BLOB_READ_WRITE_TOKEN="receipt-synthetic-only";process.env.PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN="receipt-synthetic-only";
class ReceiptSequencer extends BaseSequencer { async sort(files: TestSpecification[]) { return files.sort((a,b)=>Number(a.moduleId.endsWith("stripe-receipts.postgres.ts"))-Number(b.moduleId.endsWith("stripe-receipts.postgres.ts"))); } }
export default defineConfig({resolve:{alias:{"@":resolve(import.meta.dirname,"../../src"),"server-only":resolve(import.meta.dirname,"../stubs/server-only.ts"),"next/server":resolve(import.meta.dirname,"../../node_modules/next/server.js")}},test:{environment:"node",include:["tests/postgres/service-quality.postgres.ts","tests/postgres/stripe-receipts.postgres.ts"],fileParallelism:false,sequence:{sequencer:ReceiptSequencer},testTimeout:30000,hookTimeout:30000}});
