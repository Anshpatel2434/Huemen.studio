/**
 * A single choice as a row of chips, for forms that post (radio inputs under
 * the hood, so it needs no JavaScript). Stands in for a native select, which
 * the house rules keep out of the app.
 */
export function ChipChoice({ name, value, options }: { name: string; value: string; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className="cursor-pointer">
          <input type="radio" name={name} value={o.value} defaultChecked={o.value === value} className="peer sr-only" />
          <span className="inline-flex items-center min-h-9 px-3 rounded-full border border-line text-xs text-ink-muted hover:border-line-strong hover:text-ink peer-checked:bg-ink peer-checked:text-on-ink peer-checked:border-ink peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--focus)]">
            {o.label}
          </span>
        </label>
      ))}
    </div>
  );
}
