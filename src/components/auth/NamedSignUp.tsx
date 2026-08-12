"use client";

import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  fullNameFromSignUp,
  getSignUpName,
  saveSignUpName,
  type SignUpName,
} from "@/lib/display-name";
import { MAX_NAME_LENGTH } from "@/lib/validation/auth";

type NameErrors = Partial<Record<keyof SignUpName, string>>;

export function NamedSignUp() {
  const [name, setName] = useState<SignUpName | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [errors, setErrors] = useState<NameErrors>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = getSignUpName();
    if (saved) {
      setName(saved);
      setFirstName(saved.firstName);
      setLastName(saved.lastName);
    }
    setHydrated(true);
  }, []);

  const continueToAccount = (event: FormEvent<HTMLFormElement>) => {
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
  };

  if (!hydrated) {
    return <div className="h-[360px] w-full max-w-md" aria-hidden="true" />;
  }

  if (!name) {
    return (
      <section className="relative w-full max-w-md rounded-2xl border border-[#e4e7ec] bg-white px-7 py-8 shadow-[0_24px_60px_rgba(31,26,20,0.10)] sm:px-9">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-[-0.03em] text-[#1f2937]">Create your account</h1>
          <p className="mt-2 text-sm text-[#6b7280]">Start with the name your neighbors will see.</p>
        </div>

        <form className="mt-7 space-y-4" onSubmit={continueToAccount} noValidate>
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
            Continue
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

  return (
    <div className="relative w-full max-w-md">
      <div className="mb-3 flex items-center justify-between rounded-xl border border-[#d8e7e3] bg-white/80 px-4 py-2 text-sm text-[#4b5563]">
        <span className="truncate">Signing up as <strong className="text-[#1f2937]">{fullNameFromSignUp(name)}</strong></span>
        <button
          className="ml-3 shrink-0 font-semibold text-[#0f8f83] hover:underline"
          onClick={() => setName(null)}
          type="button"
        >
          Edit
        </button>
      </div>
      <SignUp
        path="/get-started"
        routing="path"
        signInUrl="/sign-in"
        forceRedirectUrl="/get-started/profile"
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
    </div>
  );
}
