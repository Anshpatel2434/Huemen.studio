import { visualText } from "@/lib/content/clean";

/**
 * Markdown emphasis that a model (or a platform's own syntax, WhatsApp's
 * "*bold*") left in a piece's words, removed from the drawn text. One
 * implementation, in lib/content/clean (visualText), shared by the visual
 * board, the picture brief and any other drawn text.
 */
export const stripMarkers = visualText;
