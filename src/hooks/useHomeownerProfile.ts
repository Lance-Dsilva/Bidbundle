"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import {
  describeError,
  fetchCommonProfile,
  fetchHomeownerProfile,
  patchCommonProfile,
  patchHomeownerProfile,
  removeAvatar,
  uploadAvatar,
} from "@/lib/profile-client";
import type { CommonProfile, HomeownerProfile } from "@/lib/profile-types";
import type { CommonProfileUpdate } from "@/lib/validation/profile";

/**
 * The homeowner account screen's data.
 *
 * Both records come from Neon through authenticated Route Handlers. There is
 * no local seed, no placeholder profile, and no bearer token — an unauthorised
 * response surfaces as an error the page can show and retry from.
 */

export type HomeownerProfileState = {
  profile: CommonProfile | null;
  homeowner: HomeownerProfile | null;
  loading: boolean;
  saving: boolean;
  /** Load failure. Cleared by `reload()`. */
  error: string | null;
  /** Save failure. Cleared by the next save attempt. */
  saveError: string | null;
  /** Per-field messages from the last rejected save. */
  fieldErrors: Record<string, string>;
  /** `0`–`100` while a photo is uploading, otherwise `null`. */
  uploadProgress: number | null;
  reload: () => Promise<void>;
  saveProfile: (patch: CommonProfileUpdate) => Promise<boolean>;
  saveNotifications: (patch: Partial<HomeownerProfile>) => Promise<boolean>;
  changeAvatar: (file: File) => Promise<boolean>;
  clearAvatar: () => Promise<boolean>;
};

export function useHomeownerProfile(): HomeownerProfileState {
  const [profile, setProfile] = useState<CommonProfile | null>(null);
  const [homeowner, setHomeowner] = useState<HomeownerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Guards every `setState` after an await so a screen the user has already
  // navigated away from does not update.
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
      const [common, homeownerProfile] = await Promise.all([
        fetchCommonProfile(),
        fetchHomeownerProfile(),
      ]);
      if (!mounted.current) return;
      setProfile(common);
      setHomeowner(homeownerProfile);
    } catch (caught) {
      if (!mounted.current) return;
      setProfile(null);
      setHomeowner(null);
      setError(
        caught instanceof ApiError && caught.status === 401
          ? "Your session has expired. Sign in again to see your account."
          : describeError(caught, "We could not load your account. Please try again."),
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

  const saveNotifications = useCallback(
    async (patch: Partial<HomeownerProfile>): Promise<boolean> => {
      const previous = homeowner;
      // Applied immediately so a toggle responds on tap, then rolled back on
      // failure rather than left showing a state the server rejected.
      if (previous) setHomeowner({ ...previous, ...patch });
      setSaveError(null);

      try {
        const updated = await patchHomeownerProfile(patch);
        if (mounted.current) setHomeowner(updated);
        return true;
      } catch (caught) {
        if (mounted.current) {
          setHomeowner(previous);
          setSaveError(describeError(caught, "We could not save that preference."));
        }
        return false;
      }
    },
    [homeowner],
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
    homeowner,
    loading,
    saving,
    error,
    saveError,
    fieldErrors,
    uploadProgress,
    reload,
    saveProfile,
    saveNotifications,
    changeAvatar,
    clearAvatar,
  };
}
