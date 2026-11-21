// Manual opt-in only. Requires the approved owned52-migration database and private
// /private/tmp/bundleen-stripe-test-key (sandbox secret, never committed/printed).
// Start the manager-owned Stripe CLI webhook listener before creating objects.
// Historical evidence flags are skipped, not fresh acceptance. Do not delete the
// local artifact or reset the DB to bypass ownership/reconciliation review.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {defineConfig} from "vitest/config";
const raw=process.env.TEST_DATABASE_URL;if(!raw)throw new Error("Explicit owned sandbox DB required");const url=new URL(raw);
if(url.protocol!=="postgresql:"||url.hostname!=="127.0.0.1"||url.port!=="53952"||url.pathname!=="/bundleen_issue43_test_live"||url.username!=="bundleen_issue43_runner_cards"||url.search||url.hash)throw new Error("Only owned loopback sandbox DB allowed");
const key=readFileSync("/private/tmp/bundleen-stripe-test-key","utf8").trim();if(!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key))throw new Error("Sandbox credential required");process.env.STRIPE_SECRET_KEY=key;
process.env.DATABASE_URL=raw;delete process.env.DIRECT_URL;process.env.STRIPE_TEST_APP_URL="http://localhost:4360";process.env.STRIPE_TEST_PAYMENTS="0";
process.env.RATE_LIMIT_IDENTIFIER_SECRET="sandbox-local-fixture";process.env.PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN="sandbox-local-fixture";
export default defineConfig({resolve:{alias:{"@":resolve(import.meta.dirname,"../../src"),"server-only":resolve(import.meta.dirname,"../stubs/server-only.ts"),"next/server":resolve(import.meta.dirname,"../../node_modules/next/server.js")}},test:{environment:"node",include:["tests/postgres/stripe-live-sandbox.postgres.ts"],fileParallelism:false,testTimeout:120000,hookTimeout:30000}});
