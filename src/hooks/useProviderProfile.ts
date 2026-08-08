"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import {
  describeError,
  fetchCommonProfile,
  fetchProviderProfile,
  patchCommonProfile,
  patchProviderProfile,
  putFullProviderProfile,
  removeAvatar,
  uploadAvatar,
} from "@/lib/profile-client";
import type { CommonProfile, ProviderProfile } from "@/lib/profile-types";
import type { CommonProfileUpdate, ProviderProfileUpdate } from "@/lib/validation/profile";

/**
 * The provider account screen's data.
 *
 * Same contract as {@link useHomeownerProfile}: authenticated same-origin
 * reads and writes against Neon, no placeholder record, and honest errors.
 * Verification and payout fields arrive read-only — this hook has no way to
 * write them, because the API has none.
 */

export type ProviderProfileState = {
  profile: CommonProfile | null;
  provider: ProviderProfile | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  saveError: string | null;
  fieldErrors: Record<string, string>;
  uploadProgress: number | null;
  reload: () => Promise<void>;
  saveProfile: (patch: CommonProfileUpdate) => Promise<boolean>;
  saveBusiness: (patch: ProviderProfileUpdate) => Promise<boolean>;
  /** Saves the common and provider halves of the edit form as one action. */
  saveAll: (
    commonPatch: CommonProfileUpdate,
    businessPatch: ProviderProfileUpdate,
  ) => Promise<boolean>;
  changeAvatar: (file: File) => Promise<boolean>;
  clearAvatar: () => Promise<boolean>;
};

export function useProviderProfile(): ProviderProfileState {
  const [profile, setProfile] = useState<CommonProfile | null>(null);
  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [common, providerProfile] = await Promise.all([
        fetchCommonProfile(),
        fetchProviderProfile(),
      ]);
      if (!mounted.current) return;
      setProfile(common);
      setProvider(providerProfile);
    } catch (caught) {
      if (!mounted.current) return;
      setProfile(null);
      setProvider(null);
      setError(
        caught instanceof ApiError && caught.status === 401
          ? "Your session has expired. Sign in again to see your profile."
          : describeError(caught, "We could not load your profile. Please try again."),
      );
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveProfile = useCallback(async (patch: CommonProfileUpdate): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});

    try {
      const updated = await patchCommonProfile(patch);
      if (mounted.current) setProfile(updated);
      return true;
    } catch (caught) {
      if (mounted.current) {
        if (caught instanceof ApiError && caught.fields) setFieldErrors(caught.fields);
        setSaveError(describeError(caught, "We could not save your changes."));
      }
      return false;
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, []);

  const saveBusiness = useCallback(async (patch: ProviderProfileUpdate): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});

    try {
      const updated = await patchProviderProfile(patch);
      if (mounted.current) setProvider(updated);
      return true;
    } catch (caught) {
      if (mounted.current) {
        if (caught instanceof ApiError && caught.fields) setFieldErrors(caught.fields);
        setSaveError(describeError(caught, "We could not save your business details."));
      }
      return false;
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, []);

  const saveAll = useCallback(
    async (
      commonPatch: CommonProfileUpdate,
      businessPatch: ProviderProfileUpdate,
    ): Promise<boolean> => {
      setSaving(true);
      setSaveError(null);
      setFieldErrors({});

      try {
        const updated = await putFullProviderProfile(commonPatch, businessPatch);
        if (mounted.current) {
          setProfile(updated.profile);
          setProvider(updated.provider);
        }
        return true;
      } catch (caught) {
        if (mounted.current) {
          if (caught instanceof ApiError && caught.fields) setFieldErrors(caught.fields);
          setSaveError(describeError(caught, "We could not save your profile."));
        }
        return false;
      } finally {
        if (mounted.current) setSaving(false);
      }
    },
    [],
  );

  const changeAvatar = useCallback(async (file: File): Promise<boolean> => {
    setUploadProgress(0);
    setSaveError(null);

    try {
      const result = await uploadAvatar(file, (percent) => {
        if (mounted.current) setUploadProgress(percent);
      });
      if (mounted.current) {
        setProfile((current) =>
          current
            ? { ...current, avatarUrl: result.avatarUrl, avatarUpdatedAt: result.avatarUpdatedAt }
            : current,
        );
      }
      return true;
    } catch (caught) {
      if (mounted.current) setSaveError(describeError(caught, "We could not upload that photo."));
      return false;
    } finally {
      if (mounted.current) setUploadProgress(null);
    }
  }, []);

  const clearAvatar = useCallback(async (): Promise<boolean> => {
    setSaveError(null);

    try {
      await removeAvatar();
      if (mounted.current) {
        setProfile((current) =>
          current ? { ...current, avatarUrl: null, avatarUpdatedAt: null } : current,
        );
      }
      return true;
    } catch (caught) {
      if (mounted.current) setSaveError(describeError(caught, "We could not remove that photo."));
      return false;
    }
  }, []);

  return {
    profile,
    provider,
    loading,
    saving,
    error,
    saveError,
    fieldErrors,
    uploadProgress,
    reload,
    saveProfile,
    saveBusiness,
    saveAll,
    changeAvatar,
    clearAvatar,
  };
}
