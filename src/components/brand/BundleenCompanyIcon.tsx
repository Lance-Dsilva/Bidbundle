/**
 * The Bundleen company icon: the teal lowercase `b` holding the amber roof.
 *
 * One component so every surface — the public homepage, all four dashboard
 * shells, and the shared topbar — points at the same file, sizes it the same
 * way, and treats it the same way for assistive technology. Before this, five
 * shells each inlined their own `<img>` against two different legacy logos and
 * the admin sidebar rendered a single-colour CSS mask that could not show the
 * amber at all.
 *
 * Sizing is done with the `width`/`height` *attributes*, never inline styles,
 * so the stylesheet rules that already size these marks (`.dash-sidebar-brand
 * img` at 36px, `.dash-mobile-topbar-brand img` at 30px on mobile) still win.
 * Passing a size only sets the pre-CSS intrinsic box, which is what stops the
 * mark from reflowing the header before the stylesheet applies.
 */

/** The approved artwork. Its concept-named twin stays for history. */
export const BUNDLEEN_COMPANY_ICON = "/bundleen/brand/bundleen-company-icon.svg";

type BundleenCompanyIconProps = {
  /** Intrinsic box in pixels. Omit where a stylesheet owns the size. */
  size?: number;
  className?: string;
  /**
   * Accessible name, for the rare placement with no visible "Bundleen" text
   * beside it. Beside the wordmark the icon is decorative and must stay
   * unlabelled, or a screen reader announces the brand twice.
   */
  label?: string;
};

export function BundleenCompanyIcon({ size, className, label }: BundleenCompanyIconProps) {
  return (
    <img
      src={BUNDLEEN_COMPANY_ICON}
      alt={label ?? ""}
      width={size}
      height={size}
      className={["bundleen-company-icon", className].filter(Boolean).join(" ")}
      draggable={false}
    />
  );
}
