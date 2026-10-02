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
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface Transcriber {
  transcribe(audio: Blob, filename: string): Promise<{ text: string; model: string }>;
}

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";

export function openaiTranscriber(config: TranscribeConfig, fetchImpl: FetchLike = fetch): Transcriber {
  return {
    async transcribe(audio, filename) {
      const form = new FormData();
      form.append("file", audio, filename);
      form.append("model", config.model);
      form.append("response_format", "json");

      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
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

      const body = (await res.json().catch(() => null)) as { text?: unknown } | null;
      if (!body || typeof body.text !== "string") throw new ProviderError("unparseable", "Transcription reply had no text.");
      return { text: body.text.trim(), model: config.model };
    },
  };
}
