/**
 * pai brand mark — a bold lowercase "p" whose counter (bowl)
 * is a perfect circle, giving it a friendly, approachable feel.
 * The descender grounds it while the open counter suggests
 * openness and thought. Single-color, works at any size.
 */
export function PaiLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="pai"
      className={className}
    >
      {/* Stem + descender of the "p" */}
      <rect x="6" y="4" width="4.5" height="24" rx="2.25" fill="currentColor" />
      {/* Bowl — open circle forming the counter */}
      <circle cx="18" cy="12" r="8" stroke="currentColor" strokeWidth="4.5" />
    </svg>
  );
}
