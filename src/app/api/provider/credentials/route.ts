import { NextResponse } from "next/server";
import { requireProviderConsole, requireProviderConsoleMutation } from "@/lib/server/provider-api";
import { hoaErrorResponse } from "@/lib/server/hoa-api";
import { listProviderCredentials, readCredentialForm, storeProviderCredential } from "@/lib/server/provider-credentials";
import { HoaWorkflowError } from "@/lib/server/hoa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireProviderConsole();
  if (!gate.ok) return gate.response;
  try { return NextResponse.json(await listProviderCredentials(gate.user.id), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return hoaErrorResponse("provider credentials read", error); }
}

export async function POST(request: Request) {
  const gate = await requireProviderConsoleMutation();
  if (!gate.ok) return gate.response;
  try {
    const form = await readCredentialForm(request);
    const kind = form.get("kind");
    if (kind !== "license" && kind !== "insurance") throw new HoaWorkflowError("Choose license or insurance.", 422);
    if (form.getAll("kind").length !== 1 || form.getAll("file").length !== 1 || [...form.keys()].some((key) => key !== "kind" && key !== "file")) {
      throw new HoaWorkflowError("Upload exactly one document and its credential kind.", 422);
    }
    await storeProviderCredential(gate.user.id, kind, form.get("file"));
    return NextResponse.json(await listProviderCredentials(gate.user.id), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return hoaErrorResponse("provider credential upload", error); }
}
