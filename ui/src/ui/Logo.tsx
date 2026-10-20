// The mark: a coffee cherry with a shield notch. Flat, two tones, no gradient.
export function Logo({ size = 28, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 font-semibold tracking-tight">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" role="img">
        <path
          d="M16 2c6 0 11 4.6 11 11 0 7.2-6.1 13.2-11 17C11.1 26.2 5 20.2 5 13 5 6.6 10 2 16 2Z"
          fill="var(--cherry)"
        />
        <path
          d="M16 7c3.2 0 5.8 2.5 5.8 6 0 3.8-3.2 7-5.8 9.2C13.4 20 10.2 16.8 10.2 13c0-3.5 2.6-6 5.8-6Z"
          fill="var(--surface)"
          opacity="0.22"
        />
        <path d="M16 6v15" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      </svg>
      {withWordmark && (
        <span className="text-ink">
          Kahawa<span className="text-cherry"> Guard</span>
        </span>
      )}
    </span>
  );
}
