"use client";

import { SignUp, useClerk, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { BundleenAuthLoader } from "@/components/auth/BundleenAuthLoader";
import { ClerkFormGate } from "@/components/auth/ClerkFormGate";
import { ProviderBusinessStep } from "@/components/onboarding/ProviderBusinessStep";
import { ProviderCoverageStep } from "@/components/onboarding/ProviderCoverageStep";
import { RoleStep } from "@/components/onboarding/RoleStep";
import {
  isServiceAreaDraftValid,
  type ServiceAreaDraft,
} from "@/components/provider/ProviderServiceAreaEditor";
import { StepProgress } from "@/components/onboarding/StepProgress";
import {
  VerifyAreaStep,
  type VerifiedLocation,
} from "@/components/onboarding/VerifyAreaStep";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  clearSignUpName,
  fullNameFromSignUp,
  getSignUpName,
  saveSignUpName,
  type SignUpName,
} from "@/lib/display-name";
import {
  clearOnboardingDraft,
  getOnboardingDraft,
  saveOnboardingDraft,
  type OnboardingDraft,
  type ProviderBusinessDraft,
} from "@/lib/onboarding-draft";
import { SERVICE_RADIUS_DEFAULT_MILES } from "@/lib/provider-coverage";
import { MAX_NAME_LENGTH, type PublicRole } from "@/lib/validation/auth";

type NameErrors = Partial<Record<keyof SignUpName, string>>;
type SignUpStage =
  | "session"
  | "name"
  | "role"
  | "location"
  | "provider"
  | "coverage"
  | "account";

type CountedSignUpStage = Exclude<SignUpStage, "session">;
const SIGN_UP_STAGES: Record<PublicRole, readonly CountedSignUpStage[]> = {
  homeowner: ["name", "role", "location", "account"],
  provider: ["name", "role", "location", "provider", "coverage", "account"],
};

const EMPTY_BUSINESS: ProviderBusinessDraft = {
  companyName: "",
  bio: "",
  services: [],
  serviceArea: "",
  licenseNumber: "",
  insuranceProvider: "",
};

/**
 * The wait state for the account step and for the pre-hydration render.
 *
 * Was a grey skeleton; now the same branded house every other Clerk handoff
 * shows, so a user moving between `/sign-in` and `/get-started` sees one
 * consistent transition rather than two unrelated placeholders.
 */
function AccountStepLoading() {
  return <BundleenAuthLoader context="sign-up" className={LOADER_CARD_CLASS} />;
}

const LOADER_CARD_CLASS =
  "auth-step-enter w-full rounded-2xl border border-[#e4e7ec] bg-white px-7 py-10 text-center shadow-[0_24px_60px_rgba(31,26,20,0.10)] sm:px-9";

export function NamedSignUp({ alreadyVerified = false }: { alreadyVerified?: boolean }) {
  const router = useRouter();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [stage, setStage] = useState<SignUpStage>("name");
  const [name, setName] = useState<SignUpName | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [errors, setErrors] = useState<NameErrors>({});
  const [role, setRole] = useState<PublicRole>("homeowner");
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [providerBusiness, setProviderBusiness] =
    useState<ProviderBusinessDraft>(EMPTY_BUSINESS);
  const [providerCoverage, setProviderCoverage] = useState<ServiceAreaDraft | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [sessionAccepted, setSessionAccepted] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [switchAccountError, setSwitchAccountError] = useState<string | null>(null);

  const stages = SIGN_UP_STAGES[role];
  const stepCount = stages.length;
  // Missing name data renders the name screen; session confirmation is outside
  // the numbered journey and returns before any progress indicator is shown.
  const progressStage = !name || stage === "session" ? "name" : stage;
  const stepNumber = stages.indexOf(progressStage) + 1;

  useEffect(() => {
    router.prefetch("/get-started/profile");
    const draft = getOnboardingDraft();
    const savedName = draft?.name ?? getSignUpName();
    if (savedName) {
      setName(savedName);
      setFirstName(savedName.firstName);
      setLastName(savedName.lastName);
    }
    if (draft) {
      setRole(draft.role);
      setAddress(draft.address);
      setNeighborhood(draft.neighborhood);
      setCoords({ lat: draft.latitude, lng: draft.longitude });
      setProviderBusiness(draft.providerBusiness);
      setProviderCoverage(draft.providerCoverage ?? null);
      setStage(alreadyVerified ? "session" : "account");
    } else if (alreadyVerified) {
      setStage("session");
    }
    setHydrated(true);
  }, [alreadyVerified, router]);

  useEffect(() => {
    if (!switchingAccount) return;

    // Clerk can clear its client-side user before its redirect callback
    // settles. A hard navigation guarantees that the Server Component reads
    // the new signed-out cookie state and renders the actual signup flow.
    if (user === null) {
      window.location.replace("/get-started");
      return;
    }

    const timeout = window.setTimeout(() => {
      setSwitchingAccount(false);
      setSwitchAccountError("Sign-out took too long. Please try again.");
    }, 8_000);

    return () => window.clearTimeout(timeout);
  }, [switchingAccount, user]);

  const continueFromName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextName = { firstName: firstName.trim(), lastName: lastName.trim() };
    const nextErrors: NameErrors = {};
    if (!nextName.firstName) nextErrors.firstName = "Enter your first name.";
    if (!nextName.lastName) nextErrors.lastName = "Enter your surname.";
    if (fullNameFromSignUp(nextName).length > MAX_NAME_LENGTH) {
      nextErrors.lastName = `Your full name must be ${MAX_NAME_LENGTH} characters or fewer.`;
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    saveSignUpName(nextName);
    setName(nextName);
    setStage("role");
  };

  const handleBusinessChange = <K extends keyof ProviderBusinessDraft>(
    field: K,
    value: ProviderBusinessDraft[K],
  ) => setProviderBusiness((current) => ({ ...current, [field]: value }));

  const continueFromLocation = (location: VerifiedLocation) => {
    setAddress(location.address);
    setNeighborhood(location.neighborhood);
    setCoords({ lat: location.latitude, lng: location.longitude });
    if (role === "provider") {
      // Seed the coverage circle from the base address they just verified, so
      // the map opens on somewhere real instead of a blank world view.
      setProviderCoverage(
        (current) =>
          current ?? {
            label: location.neighborhood || "My service area",
            centerLatitude: location.latitude,
            centerLongitude: location.longitude,
            radiusMiles: SERVICE_RADIUS_DEFAULT_MILES,
            formattedAddress: location.address,
            locality: location.neighborhood || null,
            region: null,
            postalCode: null,
            countryCode: null,
          },
      );
      setStage("provider");
    } else continueToAccount(location);
  };

  const continueToAccount = (location?: VerifiedLocation) => {
    if (!name) return;
    const finalCoords = location
      ? { lat: location.latitude, lng: location.longitude }
      : coords;
    const finalAddress = location?.address ?? address;
    const finalNeighborhood = location?.neighborhood ?? neighborhood;
    if (!finalCoords || !finalAddress.trim()) return;
    // A provider cannot reach Clerk's account step without a coverage circle;
    // the step's own Continue button is already disabled without one, and this
    // is the second gate for a resumed draft that predates the step.
    if (role === "provider" && !isServiceAreaDraftValid(providerCoverage)) {
      setStage("coverage");
      return;
    }

    const draft: OnboardingDraft = {
      name,
      role,
      address: finalAddress,
      neighborhood: finalNeighborhood,
      latitude: finalCoords.lat,
      longitude: finalCoords.lng,
      providerBusiness,
      providerCoverage: role === "provider" ? providerCoverage : null,
      completionAuthorized: !alreadyVerified || sessionAccepted,
    };
    saveOnboardingDraft(draft);
    setStage("account");
    if (alreadyVerified) router.replace("/get-started/profile");
  };

  if (!hydrated) {
    return (
      <div className="auth-step-enter w-full max-w-md">
        <AccountStepLoading />
      </div>
    );
  }

  if (stage === "session") {
    const accountName = user?.fullName?.trim() || "this Clerk account";
    const accountEmail = user?.primaryEmailAddress?.emailAddress;
    const draft = getOnboardingDraft();

    return (
      <section className="auth-step-enter relative w-full max-w-md rounded-2xl border border-[#d8e7e3] bg-white px-7 py-8 text-center shadow-[0_24px_60px_rgba(31,26,20,0.10)] sm:px-9">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#eaf8f5] text-xl font-bold text-[#0f8f83]">
          ✓
        </span>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f8f83]">
          Existing session detected
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-[#1f2937]">
          You’re already signed in
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#667085]">
          Continue with <strong className="text-[#1f2937]">{accountName}</strong>
          {accountEmail ? <> ({accountEmail})</> : null}. Clerk has already verified this account,
          so you do not need another email code.
        </p>

        <div className="mt-7 space-y-3">
          <Button
            className="h-11 w-full rounded-xl text-sm"
            onClick={() => {
              setSessionAccepted(true);
              if (draft) {
                saveOnboardingDraft({ ...draft, completionAuthorized: true });
                router.replace("/get-started/profile");
              } else {
                setStage("name");
              }
            }}
            variant="warm"
          >
            Continue with this account
          </Button>
          <Button
            className="h-11 w-full rounded-xl text-sm"
            disabled={switchingAccount}
            onClick={() => {
              setSwitchingAccount(true);
              setSwitchAccountError(null);
              clearOnboardingDraft();
              clearSignUpName();
              void signOut({ redirectUrl: "/get-started" })
                .then(() => window.location.replace("/get-started"))
                .catch(() => {
                  setSwitchingAccount(false);
                  setSwitchAccountError("We could not sign you out. Please try again.");
                });
            }}
            variant="secondary"
          >
            {switchingAccount ? "Signing out…" : "Use another account"}
          </Button>
        </div>

        {switchAccountError ? (
          <p aria-live="polite" className="mt-3 text-sm font-medium text-red-600">
            {switchAccountError}
          </p>
        ) : null}

        <p className="mt-5 text-xs leading-5 text-[#98a2b3]">
          To test email verification, choose another account and use an email that is not already
          registered in Clerk.
        </p>
      </section>
    );
  }

  if (stage === "name" || !name) {
    return (
      <section className="auth-step-enter relative w-full max-w-md rounded-2xl border border-[#e4e7ec] bg-white px-7 py-8 shadow-[0_24px_60px_rgba(31,26,20,0.10)] sm:px-9">
        <StepProgress current={stepNumber} total={stepCount} />
        <p className="mt-3 text-xs text-[#6b7280]">Step {stepNumber} of {stepCount}</p>
        <div className="mt-5 text-center">
          <h1 className="text-2xl font-bold tracking-[-0.03em] text-[#1f2937]">Create your account</h1>
          <p className="mt-2 text-sm text-[#6b7280]">Start with the name your neighbors will see.</p>
        </div>

        <form className="mt-7 space-y-4" onSubmit={continueFromName} noValidate>
          <Input
            autoComplete="given-name"
            autoFocus
            error={errors.firstName}
            id="first-name"
            label="First name"
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => {
              setFirstName(event.target.value);
              if (errors.firstName) setErrors((current) => ({ ...current, firstName: undefined }));
            }}
            placeholder="Jane"
            required
            value={firstName}
            variant="warm"
          />
          <Input
            autoComplete="family-name"
            error={errors.lastName}
            id="last-name"
            label="Surname"
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => {
              setLastName(event.target.value);
              if (errors.lastName) setErrors((current) => ({ ...current, lastName: undefined }));
            }}
            placeholder="Smith"
            required
            value={lastName}
            variant="warm"
          />
          <Button className="mt-2 h-11 w-full rounded-xl text-sm" type="submit" variant="warm">
            Continue to role
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-[#6b7280]">
          Already have an account?{" "}
          <Link className="font-semibold text-[#0f8f83] hover:underline" href="/sign-in">
            Sign in
          </Link>
        </p>
      </section>
    );
  }

  if (stage === "role") {
    return (
      <div className="auth-step-enter w-full max-w-[750px] rounded-[18px] border border-[#dfe3e7] bg-white px-7 shadow-[0_12px_38px_rgba(16,24,40,.07)] sm:px-9 lg:px-10">
        <RoleStep
          role={role}
          onBack={() => setStage("name")}
          onContinue={() => setStage("location")}
          onRoleChange={setRole}
          stepNumber={stepNumber}
          stepCount={stepCount}
        />
      </div>
    );
  }

  if (stage === "location") {
    return (
      <div className="auth-step-enter w-full max-w-[790px] rounded-[18px] border border-[#dfe3e7] bg-white px-7 shadow-[0_12px_38px_rgba(16,24,40,.07)] sm:px-9 lg:px-10">
        <VerifyAreaStep
          address={address}
          role={role}
          onAddressChange={setAddress}
          onBack={() => setStage("role")}
          onConfirm={continueFromLocation}
          onCoordsDetected={(lat, lng) =>
            setCoords(lat === null || lng === null ? null : { lat, lng })
          }
          onNeighborhoodDetected={setNeighborhood}
          stepNumber={stepNumber}
          stepCount={stepCount}
          confirmLabel={role === "provider" ? "Continue to business details" : "Continue to email verification"}
        />
      </div>
    );
  }

  if (stage === "provider") {
    return (
      <div className="auth-step-enter w-full max-w-xl rounded-[22px] border border-[#e4e7ec] bg-white px-7 sm:px-9">
        <ProviderBusinessStep
          data={providerBusiness}
          address={address}
          onBack={() => setStage("location")}
          onChange={handleBusinessChange}
          onContinue={() => setStage("coverage")}
          stepNumber={stepNumber}
          stepCount={stepCount}
          confirmLabel="Continue to your service area"
        />
      </div>
    );
  }

  if (stage === "coverage") {
    return (
      <div className="auth-step-enter w-full max-w-2xl rounded-[22px] border border-[#e4e7ec] bg-white px-6 sm:px-9">
        <ProviderCoverageStep
          value={providerCoverage}
          onChange={setProviderCoverage}
          onBack={() => setStage("provider")}
          onContinue={() => continueToAccount()}
          stepNumber={stepNumber}
          stepCount={stepCount}
          confirmLabel="Continue to email verification"
        />
      </div>
    );
  }

  if (alreadyVerified) {
    return (
      <div className="auth-step-enter w-full max-w-md">
        <div className="mb-3 rounded-xl border border-[#d8e7e3] bg-white px-4 py-3">
          <StepProgress current={stepNumber} total={stepCount} />
          <p className="mt-3 text-xs text-[#6b7280]">Step {stepNumber} of {stepCount}</p>
        </div>
        <AccountStepLoading />
      </div>
    );
  }

  return (
    <div className="auth-step-enter relative w-full max-w-md">
      <div className="mb-3 rounded-xl border border-[#d8e7e3] bg-white/90 px-4 py-3 text-sm text-[#4b5563]">
        <div className="mb-3">
          <StepProgress current={stepNumber} total={stepCount} />
          <p className="mt-3 text-xs text-[#6b7280]">Step {stepNumber} of {stepCount}</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#0f8f83]">
              Final step · Account and email verification
            </span>
            <span className="block truncate">
              Signing up as <strong className="text-[#1f2937]">{fullNameFromSignUp(name)}</strong>
            </span>
          </span>
          <button
            className="shrink-0 font-semibold text-[#0f8f83] hover:underline"
            onClick={() => setStage("role")}
            type="button"
          >
            Edit details
          </button>
        </div>
        <p className="mt-2 border-t border-[#e7eeec] pt-2 text-xs text-[#64748b]">
          Your role and location are ready. Verify your email to securely save them.
        </p>
      </div>
      {/* `fallback` covers Clerk's own mount, `ClerkFormGate` covers the SDK
          not having loaded at all. Only one ever renders at a time. */}
      <ClerkFormGate context="sign-up" loaderClassName={LOADER_CARD_CLASS}>
        <SignUp
          path="/get-started"
          routing="path"
          signInUrl="/sign-in"
          forceRedirectUrl="/get-started/profile"
          fallbackRedirectUrl="/get-started/profile"
          fallback={<AccountStepLoading />}
          initialValues={{ firstName: name.firstName, lastName: name.lastName }}
          appearance={{
            variables: {
              colorPrimary: "#0f8f83",
              colorForeground: "#1f2937",
              colorBackground: "#ffffff",
              borderRadius: "1rem",
            },
            elements: {
              rootBox: "relative w-full",
              cardBox: "w-full shadow-none",
              card: "border border-[#e4e7ec] shadow-[0_24px_60px_rgba(31,26,20,0.10)]",
            },
          }}
        />
      </ClerkFormGate>
    </div>
  );
}
