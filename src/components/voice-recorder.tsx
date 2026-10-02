"use client";

/**
 * Record a voice note and get its text back (Voice spec G5, C1/C2).
 *
 * Records in the browser, sends the audio once to be transcribed, and hands the
 * text to the caller to show in an editable box, so the person sees and can fix
 * exactly what will be kept. Nothing is kept until they save it.
 *
 * Off when transcription isn't configured, or when the browser can't record:
 * then the box is for typing, and the button says why it isn't there.
 */
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { btnClass } from "@/components/btn";
import { AgentDots } from "@/components/ui";

const LIMIT_S = 180;

export function VoiceRecorder({ tenantId, enabled, onText }: { tenantId: string; enabled: boolean; onText: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia);
    return () => { if (timer.current) clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); };
  }, []);

  if (!enabled) return <p className="text-[0.75rem] text-ink-faint">Recording isn&apos;t switched on here yet. Type it, or paste a transcript.</p>;
  if (!supported) return <p className="text-[0.75rem] text-ink-faint">This browser can&apos;t record. Type it, or paste a transcript.</p>;

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stop();
  };

  const start = async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("The microphone isn't available. Allow it in the browser, or type instead.");
      return;
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    rec.current = r;
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setState("sending");
      try {
        const type = r.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const fd = new FormData();
        fd.append("audio", new File(chunks, `note.${ext}`, { type }));
        const res = await fetch(`/w/${tenantId}/onboarding/transcribe`, { method: "POST", body: fd });
        const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!res.ok || !body.text) setError(body.error ?? "That didn't work. Try again, or type it.");
        else onText(body.text);
      } catch {
        setError("That didn't work. Try again, or type it.");
      } finally {
        setState("idle");
      }
    };
    r.start();
    setSeconds(0);
    setState("recording");
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= LIMIT_S) stop();
        return s + 1;
      });
    }, 1000);
  };

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {state === "recording" ? (
        <button type="button" onClick={stop} className={btnClass("danger", "sm")}>
          <Square size={13} aria-hidden="true" /> Stop · <span className="tabular-nums">{mmss}</span>
        </button>
      ) : (
        <button type="button" onClick={start} disabled={state === "sending"} className={btnClass("secondary", "sm")}>
          {state === "sending" ? <><AgentDots /> Writing it down</> : <><Mic size={14} aria-hidden="true" /> Record</>}
        </button>
      )}
      {state === "recording" && <span role="status" className="text-[0.78rem] text-ink-muted">Recording. Talk the way you would to a friend.</span>}
      {error && <span role="alert" className="text-[0.78rem] text-danger">{error}</span>}
    </div>
  );
}
