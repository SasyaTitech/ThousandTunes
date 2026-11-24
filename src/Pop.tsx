import * as React from "react";

/**
 * A control that opens a small panel next to itself. The panel exists only
 * while open; a click elsewhere or Escape puts it away. Where the panel sits
 * is the stylesheet's business, by class.
 */
export default function Pop({ className, label, title, mark, children }: { className: string; label: React.ReactNode; title: string; mark?: React.ReactNode; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && ref.current) ref.current.open = false; };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  return <details ref={ref} className={`td-pop ${className}`} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary title={title}>{mark}{label}</summary>
    {open && children}
  </details>;
}
