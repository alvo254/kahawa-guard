/** @type {import('tailwindcss').Config} */
// Colours are CSS variables (defined in src/index.css) so a single token set
// drives both light and dark mode. Tailwind utilities reference them by name:
// bg-paper, text-ink, border-line, text-cherry, bg-leaf, etc.
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        cherry: "var(--cherry)",
        "cherry-ink": "var(--cherry-ink)",
        leaf: "var(--leaf)",
        danger: "var(--danger)",
        amber: "var(--amber)",
        grape: "var(--grape)",
        slate: "var(--slate)",
        // channel brand hints, used sparingly inside the member assistant
        whatsapp: "var(--whatsapp)",
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(35,22,14,0.04), 0 8px 24px -12px rgba(35,22,14,0.18)",
        raised: "0 2px 4px rgba(35,22,14,0.06), 0 18px 40px -18px rgba(35,22,14,0.28)",
      },
      maxWidth: {
        content: "72rem",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.18s ease-out",
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
