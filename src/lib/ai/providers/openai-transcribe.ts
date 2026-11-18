/**
 * Speech to text for voice notes (Voice spec G5 and C1/C2), through OpenAI's
 * transcription endpoint. Claude reads text, not audio, so voice notes need a
 * separate provider; this is the first one built, behind the same kind of
 * facade as text (lib/ai `transcribe`).
 *
 * Plain fetch: the only call is one multipart POST, and an SDK would add a
 * dependency for it. The fetch is injectable so tests never touch the network.
 *
 * Server-only.
 */
import { ProviderError } from "../errors";

export interface TranscribeConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Another OpenAI-compatible transcription endpoint (Groq). */
  endpoint?: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface Transcriber {
  transcribe(audio: Blob, filename: string): Promise<{ text: string; model: string }>;
}

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";

/**
 * What Whisper writes for a recording with no speech in it. Its own silence
 * score is no help (Groq's turbo model reports 0 for a silent file, checked
 * 2026-11-17), so the well-known filler lines are treated as nothing heard.
 * None of them is an answer to "what do you do" or "who is it for".
 */
const SILENCE_LINES = new Set([
  "", "you", "thank you", "thanks", "thank you very much", "thanks for watching", "thank you for watching",
  "bye", "bye bye", "okay", "ok", "so", "the end", "subtitles by the amara org community", "please subscribe",
]);
export const heardNothing = (text: string): boolean =>
  SILENCE_LINES.has(text.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim());

export function openaiTranscriber(config: TranscribeConfig, fetchImpl: FetchLike = fetch): Transcriber {
  return {
    async transcribe(audio, filename) {
      const form = new FormData();
      form.append("file", audio, filename);
      form.append("model", config.model);
      // Whisper models can say how likely each stretch is to be silence; a
      // silent recording otherwise comes back as an invented "Thank you."
      const whisper = /whisper/i.test(config.model);
      form.append("response_format", whisper ? "verbose_json" : "json");

      let res: Response;
      try {
        res = await fetchImpl(config.endpoint ?? ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new ProviderError(timedOut ? "timeout" : "unknown", timedOut ? "Transcription timed out." : "Transcription request failed.");
      }

      if (!res.ok) {
        const kind =
          res.status === 401 || res.status === 403 ? "auth"
          : res.status === 429 ? "rate_limit"
          : res.status >= 500 ? "server"
          : "bad_request";
        throw new ProviderError(kind, `Transcription failed with ${res.status}.`, kind === "rate_limit" || kind === "server");
      }

      const body = (await res.json().catch(() => null)) as { text?: unknown; segments?: { no_speech_prob?: number; text?: string }[] } | null;
      if (!body || typeof body.text !== "string") throw new ProviderError("unparseable", "Transcription reply had no text.");
      // Keep only the stretches that are probably speech. With nothing left the
      // answer is "" and the caller says nothing was heard (never invented words).
      if (Array.isArray(body.segments) && body.segments.length) {
        const spoken = body.segments.filter((s) => typeof s.no_speech_prob !== "number" || s.no_speech_prob < 0.6);
        if (spoken.length !== body.segments.length) {
          return { text: spoken.map((s) => (s.text ?? "").trim()).filter(Boolean).join(" ").trim(), model: config.model };
        }
      }
      return { text: heardNothing(body.text) ? "" : body.text.trim(), model: config.model };
    },
  };
}
