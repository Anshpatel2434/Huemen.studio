/** Editable Brand Foundation shape (brief §4.1). Pure type — client-safe. */
export interface FoundationForm {
  niche: string;
  positioning: string;
  offers: string;
  audience: string;
  chapters: { title: string; body: string }[]; // exactly 3
  tone: string; // comma-separated
  doWords: string; // comma-separated
  dontWords: string; // comma-separated
  readingLevel: string;
  samplePosts: string; // one per line
  palette: string; // comma-separated hex
  fonts: string; // comma-separated
  imageStyleNotes: string;
}
