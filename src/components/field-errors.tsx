"use client";

/**
 * Huemen's own field errors, in place of the browser's validation bubbles
 * (house rule: no system UI). Mounted once in the root layout, it catches
 * every `invalid` event (required, type="email", min, pattern...) before the
 * browser draws its bubble, and writes a plain message under the field
 * instead, tied to it with aria-describedby. The message goes as soon as the
 * field is edited. Forms keep their native checks; only the look changes.
 */
import { useEffect } from "react";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function messageFor(el: Field): string {
  const v = el.validity;
  if (v.valueMissing) return el.type === "file" ? "Choose a file." : "Fill this in.";
  if (v.typeMismatch && el.type === "email") return "Enter an email address, like name@example.com.";
  if (v.typeMismatch && el.type === "url") return "Enter a web address, like https://example.com.";
  if (v.rangeUnderflow && "min" in el) return `Use ${el.min} or more.`;
  if (v.rangeOverflow && "max" in el) return `Use ${el.max} or less.`;
  if (v.stepMismatch) return "Use a whole number.";
  if (v.tooShort && "minLength" in el) return `Use at least ${el.minLength} characters.`;
  if (v.patternMismatch) return el.title || "That isn't in the expected format.";
  if (v.badInput) return "That isn't a number.";
  return el.validationMessage || "Check this field.";
}

export function FieldErrors() {
  useEffect(() => {
    let first = true;
    const onInvalid = (e: Event) => {
      const el = e.target as Field;
      if (!el || !("validity" in el)) return;
      e.preventDefault(); // no browser bubble
      const id = el.id || (el.id = `f-${Math.random().toString(36).slice(2, 9)}`);
      const errId = `${id}-error`;
      let note = document.getElementById(errId);
      if (!note) {
        note = document.createElement("p");
        note.id = errId;
        note.setAttribute("role", "alert");
        note.className = "hu-field-error";
        el.insertAdjacentElement("afterend", note);
      }
      note.textContent = messageFor(el);
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("aria-describedby", [el.getAttribute("aria-describedby"), errId].filter(Boolean).join(" "));
      // Focus the first bad field of a submit, as the browser would.
      if (first) {
        first = false;
        el.focus();
        queueMicrotask(() => { first = true; });
      }
    };
    const onInput = (e: Event) => {
      const el = e.target as Field;
      if (!el?.id || el.getAttribute("aria-invalid") !== "true") return;
      document.getElementById(`${el.id}-error`)?.remove();
      el.removeAttribute("aria-invalid");
      const rest = (el.getAttribute("aria-describedby") ?? "").split(" ").filter((x) => x && x !== `${el.id}-error`).join(" ");
      if (rest) el.setAttribute("aria-describedby", rest);
      else el.removeAttribute("aria-describedby");
    };
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
    };
  }, []);
  return null;
}
