"use client";

/**
 * Huemen's own dropdown, in place of the browser's <select> (house rule: no
 * system UI). A button that opens a list styled like every other Huemen menu
 * (hu-menu), with the keyboard a listbox needs: arrows, Home/End, Enter or
 * Space to pick, Escape to close, and a letter to jump.
 *
 * Works in a plain form: with `name`, the value travels in a hidden input.
 * Controlled with `value` + `onChange`, or uncontrolled with `defaultValue`.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  options, value, defaultValue, onChange, name, label, className = "", variant = "field", placeholder = "Choose", disabled,
}: {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  /** Accessible name when there is no visible label. */
  label?: string;
  className?: string;
  /** "field" for forms, "pill" for a compact control in a toolbar or composer bar. */
  variant?: "field" | "pill";
  placeholder?: string;
  disabled?: boolean;
}) {
  const [own, setOwn] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value ?? own;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const chosen = options.find((o) => o.value === current);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    list.current?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const show = () => {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    setOpen(true);
  };
  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (value === undefined) setOwn(o.value);
    onChange?.(o.value);
    setOpen(false);
    button.current?.focus();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    if (e.key === "ArrowDown") setActive((a) => Math.min(last, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "Enter" || e.key === " ") pick(active);
    else if (e.key === "Escape" || e.key === "Tab") { setOpen(false); if (e.key === "Escape") button.current?.focus(); return; }
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const from = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(k));
      const hit = from >= 0 ? from : options.findIndex((o) => o.label.toLowerCase().startsWith(k));
      if (hit >= 0) setActive(hit);
      else return;
    } else return;
    e.preventDefault();
  };

  return (
    <div ref={root} className={`hu-select ${variant === "pill" ? "hu-select--pill" : ""} ${className}`}>
      {name && <input type="hidden" name={name} value={current} />}
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={label ? `${label}: ${chosen?.label ?? placeholder}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); show(); } }}
        className={variant === "pill" ? "hu-select__pill" : "field hu-select__field"}
      >
        <span className={`truncate ${chosen ? "" : "text-ink-faint"}`}>{chosen?.label ?? placeholder}</span>
        <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-ink-faint" />
      </button>
      {open && (
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKey}
          className="hu-menu hu-select__list"
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={o.value === current}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
              className={`hu-menu__item cursor-pointer ${i === active ? "hu-select__item--active" : ""}`}
            >
              <span className="flex-1 truncate">{o.label}</span>
              {o.value === current && <Check size={15} aria-hidden="true" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
