/** The mark's proportions, shared with the share card, which draws it on a canvas. Units are thirtieths of its height. */
export const MARK = { width: 42.625, height: 30, bar: 5.75, dot: 4.625, dots: [15, 26.5, 38] } as const;

/**
 * The mark without the icon's tile: one stroke and three dots. A thousand
 * written 1 000, a bar of four with its downbeat, a string and its inlays.
 * The stroke is cinnabar; the dots take the text colour of where it stands.
 */
export default function Logo({ className = "" }: { className?: string }) {
  return <svg className={`td-logo ${className}`} viewBox={`0 0 ${MARK.width} ${MARK.height}`} role="img" aria-label="千曲">
    <rect width={MARK.bar} height={MARK.height} rx={MARK.bar / 2} fill="var(--seal)" />
    {MARK.dots.map(cx => <circle key={cx} cx={cx} cy={MARK.height / 2} r={MARK.dot} fill="currentColor" />)}
  </svg>;
}
