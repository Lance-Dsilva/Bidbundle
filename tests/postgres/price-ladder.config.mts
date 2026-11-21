import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
const raw=process.env.TEST_DATABASE_URL;
if(!raw)throw new Error("Explicit disposable database required");
const u=new URL(raw);if(u.hostname!=="127.0.0.1" || u.port!=="53949" || !/^\/issue49_test(?:_v\d+)?$/.test(u.pathname) || u.search)throw new Error("Refusing non-disposable issue49 database");
process.env.DATABASE_URL=raw;delete process.env.DIRECT_URL;
export default defineConfig({resolve:{alias:{"@":resolve(import.meta.dirname,"../../src"),"server-only":resolve(import.meta.dirname,"../stubs/server-only.ts")}},test:{environment:"node",include:["tests/postgres/price-ladder.postgres.ts"],fileParallelism:false,testTimeout:20000}});
