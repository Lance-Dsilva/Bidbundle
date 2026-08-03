import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas:        "var(--color-canvas)",
        "canvas-alt":  "var(--color-canvas-alt)",
        surface:       "var(--color-surface)",
        "surface-mid": "var(--color-surface-mid)",
        primary:       "var(--color-primary)",
        accent:        "var(--color-accent)",
        "accent-bright":"var(--color-accent-bright)",
        "accent-light": "var(--color-accent-light)",
        card:          "var(--color-card)",
        divider:       "var(--color-divider)",
        "divider-mid": "var(--color-divider-mid)",
        muted:         "var(--color-muted)",
        secondary:     "var(--color-secondary)",
        foreground:    "var(--color-foreground)",
        success:       "var(--color-success)",
        "success-light":"var(--color-success-light)",
        error:         "var(--color-error)",
        "error-light": "var(--color-error-light)",
      },
      fontFamily: {
        sans:    ["var(--font-body)", "DM Sans", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      borderRadius: {
        card:  "var(--radius-card)",
        pill:  "var(--radius-pill)",
        input: "var(--radius-input)",
      },
      boxShadow: {
        sm:           "var(--shadow-sm)",
        card:         "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        float:        "var(--shadow-float)",
        surface:      "var(--shadow-surface)",
      },
      letterSpacing: {
        tightest: "-0.04em",
        tighter:  "-0.025em",
      },
    },
  },
  plugins: [],
};

export default config;
