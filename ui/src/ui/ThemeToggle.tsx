import { useTheme } from "../lib/theme";
import { cx } from "./primitives";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={cx(
        "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line text-ink hover:bg-surface-2",
        className,
      )}
    >
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          {[...Array(8)].map((_, i) => (
            <line
              key={i}
              x1="12"
              y1="1.5"
              x2="12"
              y2="4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              transform={`rotate(${i * 45} 12 12)`}
            />
          ))}
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  );
}
