import type { CSSProperties } from "react";

export type CreativeIconName =
  | "arrow-right"
  | "bell"
  | "bids"
  | "chat"
  | "cleaning"
  | "clipboard"
  | "electrical"
  | "gavel"
  | "home"
  | "lawn"
  | "location-pin"
  | "logo-house"
  | "menu"
  | "more"
  | "neighbors"
  | "painting"
  | "piggy-bank"
  | "play"
  | "plumbing"
  | "plus"
  | "profile"
  | "search"
  | "tag"
  | "users";

interface CreativeIconProps {
  name: CreativeIconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders a BidBundle "Creative Redesign" icon (website-redesign/bidbundle-creative-redesign).
 * Unlike the older Icon component, these SVGs carry their own fixed navy/teal/amber
 * fills — render as a plain image, don't recolor via currentColor mask.
 */
export function CreativeIcon({ name, size = 24, className, style }: CreativeIconProps) {
  return (
    <img
      src={`/creative/icons/${name}.svg`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, flexShrink: 0, ...style }}
    />
  );
}
