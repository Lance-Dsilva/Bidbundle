// @vitest-environment jsdom
import {cleanup,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {ServiceGuarantee} from "@/components/sharing/ServiceGuarantee";
afterEach(()=>{cleanup();vi.unstubAllEnvs()});
it("does not publish the promise from intake or sandbox payments alone",()=>{vi.stubEnv("SERVICE_QUALITY_INTAKE","1");vi.stubEnv("STRIPE_TEST_PAYMENTS","1");vi.stubEnv("SERVICE_QUALITY_GUARANTEE","0");render(<ServiceGuarantee/>);expect(screen.queryByRole("region")).toBeNull()});
it("requires intake even when release flag is enabled",()=>{vi.stubEnv("SERVICE_QUALITY_INTAKE","0");vi.stubEnv("SERVICE_QUALITY_GUARANTEE","1");render(<ServiceGuarantee/>);expect(screen.queryByRole("region")).toBeNull()});
it("publishes the scoped visit remedy when both gates are enabled",()=>{vi.stubEnv("SERVICE_QUALITY_INTAKE","1");vi.stubEnv("SERVICE_QUALITY_GUARANTEE","1");render(<ServiceGuarantee/>);expect(screen.getByRole("region",{name:"Bundleen guarantee"})).toHaveTextContent("within 72 hours");expect(screen.getByRole("region")).toHaveTextContent("refund that visit")});
