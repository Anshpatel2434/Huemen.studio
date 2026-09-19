/**
 * Demo data for the UI prototype. This is MOCK content so the screens can be
 * seen and clicked without the database. Real screens swap these for
 * loadBrandContext / RLS-scoped queries (see HANDOVER.md §5). Nothing here is
 * wired to Postgres on purpose.
 */

export const demoWorkspace = {
  name: "Alex Rivera",
  person: "Alex Rivera",
  handle: "@alexrivera",
  role: "client" as const,
  completeness: 90,
};

export const demoWorkspaces = [
  { name: "Alex Rivera", handle: "Personal brand · B2B founder", initial: "A" },
  { name: "Priya Shah", handle: "Cohort · Fintech", initial: "P" },
  { name: "Marcus Lee", handle: "1:1 · Design leadership", initial: "M" },
];

export const pillars = ["Authority", "Systems", "Contrarian takes", "Client wins"];

export const pillarColor: Record<string, string> = {
  Authority: "#FF3429",
  Systems: "#111111",
  "Contrarian takes": "#69727D",
  "Client wins": "#33373D",
};

export const brandPalette = ["#000000", "#FF3429", "#F4F4F4"];

export type ContentFormat = {
  key: string;
  label: string;
  channel: string;
  desc: string;
};

export const contentFormats: ContentFormat[] = [
  { key: "linkedin_post", label: "LinkedIn post", channel: "LinkedIn", desc: "A single on-brand post with hook, body and CTA." },
  { key: "linkedin_hook_set", label: "Hook set", channel: "LinkedIn", desc: "5 scroll-stopping opening lines to choose from." },
  { key: "ig_caption", label: "Instagram caption", channel: "Instagram", desc: "Caption tuned for reach and saves." },
  { key: "ig_carousel", label: "Carousel copy", channel: "Instagram", desc: "Slide-by-slide copy for a carousel." },
  { key: "newsletter", label: "Newsletter section", channel: "Email", desc: "One section for your next issue." },
  { key: "pitch_email", label: "Pitch email", channel: "Email", desc: "A warm outreach built from your offers." },
  { key: "talk_abstract", label: "Talk abstract", channel: "Speaking", desc: "A talk pitch from your positioning." },
];

export const demoVariants: string[] = [
  `Most "personal branding" advice is just noise dressed up as strategy.\n\nHere's what actually moved the needle for the founders I work with:\n\n1. Pick one belief you'll defend in public.\n2. Say it the same way for 90 days.\n3. Let the people who disagree self-select out.\n\nClarity compounds. A system beats a burst every time.\n\nWhat's the one belief you'd put your name on?`,
  `Your strategy should have thick skin.\n\nIf your positioning falls apart the moment someone pushes back, it was never positioning — it was a wish.\n\nThe brands that last aren't the loudest. They're the ones with a point of view they'll repeat until it's boring to them and unforgettable to everyone else.\n\nSay the true thing. Say it again tomorrow.`,
];

export const guardrailFlags = [
  { word: "leverage", note: "on your don't-words list" },
];

export const demoContentItems = [
  { id: "1", format: "LinkedIn post", pillar: "Contrarian takes", status: "approved", hook: "Most personal branding advice is noise…", updated: "2h ago" },
  { id: "2", format: "Carousel copy", pillar: "Systems", status: "draft", hook: "The 5-part system behind a repeatable brand", updated: "yesterday" },
  { id: "3", format: "Hook set", pillar: "Authority", status: "edited", hook: "5 hooks on why authority ≠ visibility", updated: "3d ago" },
  { id: "4", format: "Pitch email", pillar: "Client wins", status: "draft", hook: "How we took a founder from 0 → 12k in 90 days", updated: "5d ago" },
];

export const demoQuote = {
  text: "Say the true thing. Say it again tomorrow.",
  author: "Alex Rivera",
};

export const demoCarousel = [
  { n: 1, title: "Your strategy should have thick skin", body: "If it falls apart under one objection, it was a wish — not positioning." },
  { n: 2, title: "Pick one belief", body: "Choose a point of view you'll defend in public for 90 days straight." },
  { n: 3, title: "Repeat it", body: "Boring to you = unforgettable to them. Consistency compounds." },
  { n: 4, title: "Let people self-select", body: "The ones who disagree leave. The ones who stay become fans." },
  { n: 5, title: "Your move", body: "What's the one belief you'd put your name on?" },
];

export const demoIdeas = [
  { id: "1", text: "Contrarian take: 'thought leadership' is mostly follower-ship in a nicer outfit.", pillar: "Contrarian takes", source: "paste", status: "new" },
  { id: "2", text: "Break down the 3-chapter story arc we use in workshops.", pillar: "Systems", source: "paste", status: "new" },
  { id: "3", text: "Client win: founder booked 4 podcasts in a month after repositioning.", pillar: "Client wins", source: "email", status: "converted" },
  { id: "4", text: "Why niching down felt terrifying and worked anyway.", pillar: "Authority", source: "paste", status: "new" },
];

export const demoOffers = [
  { id: "1", name: "Brand Foundations Intensive", format: "1:1, 2 weeks", promise: "A positioning you'll defend in public.", price: "£2,400" },
  { id: "2", name: "Cohort: Authority in 90 Days", format: "Group, 12 weeks", promise: "A repeatable content system, not a burst.", price: "£1,200" },
  { id: "3", name: "Executive Ghost-brand", format: "Retainer", promise: "Your voice, shipped weekly, without you writing.", price: "£4,500/mo" },
];

// 90-day calendar → a few weeks of demo slots.
const channels = ["LinkedIn", "Instagram", "Email", "LinkedIn"];
export const demoCalendar = Array.from({ length: 28 }, (_, i) => {
  const has = i % 2 === 0 || i % 7 === 1;
  return {
    day: i + 1,
    pillar: has ? pillars[i % pillars.length] : null,
    channel: has ? channels[i % channels.length] : null,
    topic: has ? demoContentItems[i % demoContentItems.length].hook : null,
  };
});

export const demoUsage = {
  generations: 148,
  images: 37,
  activeUsers: 3,
  softCap: 200,
  hardCap: 250,
};

export const strategyTools = [
  { key: "niche", title: "Niche validation", desc: "Pressure-test who you serve and why it's defensible." },
  { key: "positioning", title: "3×3 positioning matrix", desc: "Map your position against the field on two axes." },
  { key: "authority", title: "Authority ladder", desc: "The rungs from unknown to sought-after in your niche." },
  { key: "growth", title: "Q1–Q4 growth plan", desc: "A quarter-by-quarter plan built from your pillars." },
];
