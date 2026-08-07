import type { CSSProperties } from "react";

export type IconName =
  | "arrow-right"
  | "bell"
  | "bids"
  | "calendar"
  | "chat"
  | "check-circle"
  | "chevron-right"
  | "cleaning"
  | "clipboard"
  | "clock"
  | "dollar"
  | "edit"
  | "electrical"
  | "home"
  | "house"
  | "info"
  | "logo-mark"
  | "logout"
  | "mail"
  | "map-pin"
  | "moon"
  | "more-grid"
  | "painting"
  | "phone"
  | "play"
  | "plumbing"
  | "plus"
  | "profile"
  | "scale"
  | "search"
  | "shield"
  | "sliders"
  | "sparkle"
  | "tag"
  | "tools"
  | "users";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders a Bundleen icon from the existing icon asset collection as a currentColor
 * mask, so it can be recolored via CSS like the reference implementation.
 */
export function Icon({ name, size = 24, className, style }: IconProps) {
  const url = `/bundleen/icons/${name}.svg`;
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        background: "currentColor",
        WebkitMask: `url(${url}) center / contain no-repeat`,
        mask: `url(${url}) center / contain no-repeat`,
        ...style,
      }}
    />
  );
}
