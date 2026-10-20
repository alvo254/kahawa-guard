// Kahawa Guard component library — small, owned, accessible primitives.
// Every colour comes from a CSS token (index.css); nothing is hardcoded here.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Tone } from "../lib/types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const TONE_TEXT: Record<Tone, string> = {
  allow: "text-leaf",
  block: "text-danger",
  park: "text-amber",
  flag: "text-grape",
  info: "text-slate",
};
const TONE_DOT: Record<Tone, string> = {
  allow: "bg-leaf",
  block: "bg-danger",
  park: "bg-amber",
  flag: "bg-grape",
  info: "bg-slate",
};
const TONE_SOFT: Record<Tone, string> = {
  allow: "bg-leaf/10 text-leaf ring-leaf/25",
  block: "bg-danger/10 text-danger ring-danger/25",
  park: "bg-amber/10 text-amber ring-amber/25",
  flag: "bg-grape/10 text-grape ring-grape/25",
  info: "bg-slate/10 text-slate ring-slate/25",
};

/* ---------- Button ---------- */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md";
};
export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = size === "sm" ? "text-sm px-3 py-1.5" : "px-4 py-2.5";
  const variants = {
    primary: "bg-cherry text-white hover:bg-cherry-ink",
    danger: "bg-danger text-white hover:brightness-110",
    outline: "border border-line text-ink hover:bg-surface-2",
    ghost: "text-ink hover:bg-surface-2",
  }[variant];
  return <button className={cx(base, sizes, variants, className)} {...rest} />;
}

/* ---------- Card ---------- */
export function Card({
  children,
  className,
  raised,
}: {
  children: ReactNode;
  className?: string;
  raised?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-line bg-surface",
        raised ? "shadow-raised" : "shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h3 className="font-semibold text-ink">{title}</h3>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/* ---------- Badge / StatusDot ---------- */
export function Badge({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE_SOFT[tone],
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone = "info", pulse }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span
      className={cx("inline-block h-2 w-2 shrink-0 rounded-full", TONE_DOT[tone], pulse && "animate-pulse-dot")}
      aria-hidden="true"
    />
  );
}

export function toneText(tone: Tone) {
  return TONE_TEXT[tone];
}

/* ---------- Toggle ---------- */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
  id: string;
}) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-leaf" : "bg-line",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/* ---------- Meter ---------- */
export function Meter({
  value,
  label,
  caption,
  tone = "allow",
}: {
  value: number; // 0..100
  label: ReactNode;
  caption?: ReactNode;
  tone?: Tone;
}) {
  const over = value >= 90;
  const fill = over ? "bg-danger" : TONE_DOT[tone];
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        {caption && <span className="text-xs tabular-nums text-muted">{caption}</span>}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className={cx("h-full rounded-full transition-[width] duration-500", fill)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/* ---------- Spinner / Empty / Field ---------- */
export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-cherry" aria-hidden="true" />
      {label}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}
