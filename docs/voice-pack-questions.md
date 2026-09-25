# Voice Pack (v2) — our questions, in one list

**From:** the build team
**On:** `hueman-voice.zip` → `v2-latest/` (files 00–07), read in full
**Date:** 25 September 2026

---

## Short version

The spec is good, and unusually buildable. Files 05, 06 and 07 are detailed enough to build from without a workshop, which is rare. The three rules at the end of your note — real writing beats answers, every trait needs evidence, universal rules at platform level and personal rules per person — are the right three, and the architecture actually enforces them.

Almost everything we need to settle is at the edges, not in the middle: **who owns a Voice Pack, what we are legally allowed to read, and what happens when the spec meets the app we have already built.** Those are questions 1–13. The rest are smaller.

Every question below has **our recommendation** attached. If you agree with one, you can just say "yes to 4" and we'll build it that way. The ones marked **BLOCKING** are the ones we can't start without. Questions 1 and 2 are already settled and built — they are kept here so the reasoning stays on the record.

---

## Where this lands in what's already built

Worth knowing before you answer, because it shapes a few of the questions.

The studio today already has a thin version of this. There is a voice record per brand, holding tone words, do-words, never-words, reading level and sample posts. All three brand records — profile, voice, visual — compose into **one** serialised brand context block, produced by one versioned function, and every prompt in the system is injected with it. Nothing assembles its own context. That rule is what stops voice drift, and it is the thing the Voice Pack has to plug into.

The brief step already asks the user for three tone words, their never-words and three sample posts. So **file 05's Core flow overlaps our existing intake**, and `voice.json` overlaps the guardrails our context builder already emits.

That isn't a problem. It does mean question 1 needs answering before we write any code, because the two models disagree about who a voice belongs to.

---

# The questions

## A. Scope and ownership

**1. Does a Voice Pack belong to a person or to a brand? — SETTLED: a person. Built.**
The spec says "one Voice Pack per user, isolated storage per user". Our app was built the other way round: a workspace holds brands, a brand holds a voice, and several people work inside one workspace. A coach using the white-label writes *on behalf of* their clients, so the person typing is not the person whose voice it is.
*Decision:* the pack belongs to a **person**, and a brand points at one. One person can lend their voice to several brands; one brand has exactly one voice. Done — the demo workspace's three brands now share one voice instead of three.

**2. Does the Voice Pack replace the voice step we already have? — SETTLED: it replaces it. Built.**
We asked for tone words, never-words and sample posts in the brief. File 05 asks for richer versions of all three.
*Decision:* it **replaces** them. The brief's voice fields are now a view of the pack — they read from it and write to it — so nothing downstream breaks while the pack becomes the only place a voice lives.

**3. What happens to the brands already in the system?**
Anyone already set up has tone words and sample posts but no pack.
*Our recommendation:* generate a provisional pack from what they already gave us, mark every field `inferred`, and prompt them to run a scan. Nothing breaks, and nothing is silently promoted to "measured".

**4. Who can see and edit a pack?**
Can a coach read a client's guardrails? Their scanned email register? Can the client see what the coach changed?
*Our recommendation:* the coach can read and propose, the owner approves, and every change sits in the version history with a name against it. Private-source material — email, chat — is visible to the owner only, never to the coach. Only the measured numbers derived from it are shared.

**5. Can a person have more than one voice?**
Some people write as themselves and as their company, and those are genuinely different voices.
*Our recommendation:* yes, but not in the first release. We'll design the storage for it now so we don't have to migrate later.

**6. What happens to a pack when someone leaves, or a workspace is deleted?**
A real question for the white-label: if a coach's client leaves, whose data is it?
*Our recommendation:* the pack follows the person. On deletion the coach loses access, the person keeps the pack and can export it. Please confirm — this needs to match whatever your contracts say.

---

## B. Data, consent and the law

This section affects the timeline more than any other, so it's the one worth settling first.

**7. Which sources are in scope for the first release? (BLOCKING)**
File 06 lists thirteen. They are not equally available to us, and the gap is not small.

| Source | How we can actually get it | Effort |
|---|---|---|
| LinkedIn posts | The user's own data export, uploaded. We believe there is **no** API giving a third party a member's own posts | Low |
| Instagram | Export for personal accounts; API only for business/creator accounts, after app review | Low / High |
| X | Reading own posts needs a paid API tier | Low, quick |
| Newsletter, blog, Medium, website | Public URL or export | Low |
| Podcast, YouTube, talks | RSS or captions, plus transcription | Medium |
| **Sent email (Gmail)** | A restricted Google scope: verification plus an annual third-party security assessment. **Weeks, and a recurring bill** | High |
| **Sent email (Outlook)** | Microsoft Graph, publisher verification, and an admin's consent for anyone on a company tenant | High |
| WhatsApp | The user's own chat export, uploaded | Low |
| Slack / Teams | An app installed per workspace, usually needing admin approval | Medium |
| Documents | Upload | Low |

*Our recommendation:* release one is **upload, paste and public URLs**. That covers every source in the spec, needs no platform approval, and avoids the terms question entirely. Official connections come after, starting with Gmail, because sent email is the highest-value source and the one you called out. If you want Gmail at launch, tell us now — the assessment has to start immediately.

**8. Scraping: yes or no? (BLOCKING)**
File 06 allows a scraper for a user's own public profile with a consent tick, and says to check each platform's terms. We've checked enough to say that at least one major platform prohibits it outright, regardless of whose profile it is or who consented.
*Our recommendation:* **no scraping in the product.** The user's own export gives us the same content with better coverage and no risk. If you want it anyway we'd need that from you in writing, because it's a business risk rather than a technical one.

**9. Who is the data controller? (BLOCKING)**
Under India's DPDP Act someone has to be. Is it hueman.studio, or the coach whose brand the client sees?
*Our recommendation:* hueman.studio is the controller and the coach is a viewer. Anything else means every coach needs their own privacy notice, which isn't workable.

**10. Which AI provider sees a user's corpus, and under what terms?**
"We never train shared models on a user's content" is a promise about us. It also has to be a promise about whoever we send the text to. The studio runs on a stand-in provider today, so this is still open.
*Our recommendation:* a provider on a **zero-retention, no-training** agreement, named in the privacy notice. If you have a preference or an existing contract, tell us. Otherwise we'll pick, and tell you what we picked.

**11. How long do we keep private-source material, and can the user see it?**
The spec says sample around 200 sent emails, keep 12 months, strip other people's words. It doesn't say how long we hold them after the scan.
*Our recommendation:* keep the stripped snippets only while the pack is live, show the user exactly what we stored with a delete button per item, and delete everything from a source within 24 hours of them removing it.

**12. The rule that private sources teach rhythm but never facts — how hard is it?**
There's a tension here. File 06 routes chat and email into `samples.md`, and also says no facts leave private sources. If a real sent email is used as a writing sample, its facts are in front of the model, and they can surface in a draft.
*Our recommendation:* private sources feed **measurements and register only** — sentence length, sign-offs, how they ask, how they push back. They never become few-shot samples. Public writing does that job. This is the one place we'd push back on the spec, and we think it's the difference between "private sources are safe" and "private sources are probably safe".

**13. Do we need consent from Richa and Rohan?**
Their writing is in the zip and Richa's real posts are coming. We'll be storing them in a development database and sending them to a model provider.
*Our recommendation:* a written line from each covering use as test data. Cheap now, awkward later.

---

## C. The scan in practice

**14. What do we do when someone has almost nothing written?**
G5 — three voice notes — is the answer in the spec, and it's a good one. It needs transcription, and our users won't all record in English.
*Our recommendation:* build G5 with transcription covering English, Hindi and Hinglish. Tell us which of the others in C10 matter, because it changes which transcriber we choose.

**15. How much of the corpus goes into each draft?**
The spec says target 30–40 pieces and "load samples from that platform first". If that means all of them, a single draft carries roughly ten thousand words of examples before it writes a line. That is slow, and it costs real money on every draft.
*Our recommendation:* measure on the **whole** corpus, but put only **6–8 pieces** in any one prompt: the three benchmarks plus the closest-to-median pieces from the target platform. Same quality, a fraction of the cost.

**16. When aspiration beats measurement, what does the voice check score against?**
H1 lets someone say "write how I *want* to write" and flags it `aspiration`. But the check is built on the measured numbers, so a draft obeying the aspiration fails its own check.
*Our recommendation:* the aspiration **replaces** the measured value as the target, and we keep the measured value beside it as history. The check scores against the target. Please confirm — it's a one-line decision with a lot downstream of it.

**17. Where do the universal anti-AI rules sit in the order of precedence?**
File 07 gives us: hard limits > user guardrails > the user's platform habits > platform norms. The anti-AI list isn't in that order, and files 01 and 04 say a personal habit beats it — Richa's ellipsis.
*Our recommendation:* slot it between guardrails and platform habits, and let a **proven** personal habit override it. Proven meaning it's in the corpus with a count, not merely claimed. Confirm that's what you meant.

**18. Who owns and updates the platform rules in file 07?**
The numbers go stale. Limits change, "see more" cut-offs change.
*Our recommendation:* we keep them in config so it's a one-line change, and we re-check them quarterly. Confirm you want us to own that rather than someone on your side.

**19. Ghostwritten-content detection will get it wrong sometimes.**
The signals in the spec — an em-dash spike, uniform sentence length — will flag genuine writing by someone who writes tidily.
*Our recommendation:* never auto-exclude. Always ask (H3), default the answer to "yes, mine", and keep it to one card.

---

## D. The product and the flow

**20. Where does the Core intake sit — at sign-up, or inside a project?**
Ours is a project-based tool. The Voice Pack is a person-level thing.
*Our recommendation:* **once per person, at sign-up**, before their first project. Every project after that inherits it. Otherwise the same person answers the same ten steps over and over.

**21. Can someone skip the scan and still use the product?**
Some people won't connect or upload anything on day one.
*Our recommendation:* yes, but the pack is marked provisional, every context block reads `inferred`, and the UI says so plainly. We don't want a first draft judged as "the product" when it's really "the product with nothing to go on".

**22. Does the user see the eight markdown files?**
The spec chose markdown partly so the user can open and edit them. Our interface is a canvas, not a file browser.
*Our recommendation:* show the pack as editable **cards**, one per file, every field carrying its evidence and its source tag, with "download the raw files" for the people who want them. The files stay the source of truth underneath.

**23. Does a failing voice check block anything?**
The spec defines the check but not the consequence.
*Our recommendation:* it warns, loudly, and never blocks. Show the score and the two or three fixes. Blocking approval on a machine score will annoy exactly the people we want.

**24. Drip-feeding the Deep questions — what's the trigger?**
*Our recommendation:* offer two or three after every fifth approved piece, and never interrupt someone mid-draft. Confirm you don't want a fixed schedule instead.

**25. How aggressive is learning from edits?**
The spec's example is a word deleted four times.
*Our recommendation:* four is a good threshold, and nothing is ever applied silently. It becomes a proposal card carrying its evidence: "you deleted 'unpack' four times — ban it?" Confirm the never-silent part especially, because it costs a little friction and buys a lot of trust.

---

## E. Quality and done

**26. How do we prove "sounds like them"? (BLOCKING for sign-off, not for build)**
Section 7 of file 01 tells us when a pack is *complete*. It doesn't tell us how we know the output is *right*.
*Our recommendation:* a blind test. Five pieces, some theirs, some ours, and the person picks which are which. If they can't reliably tell, we're there. We'd like to run it on Richa first, since she's the reference.

**27. When do Richa's real posts arrive?**
Her `samples.md` currently holds two pieces marked as made up. We can't test against an invented corpus, and she's the reference output for the whole build.
*Our recommendation:* we need them before we start the scan — item 2 in your build order. This is the one dependency on your side that could hold us up.

**28. Is Rohan a test case too, or only an illustration?**
*Our recommendation:* a test case. He's the proof that the opposite of Richa also works — his ban on the ellipsis against her use of it. A build that satisfies both has a personal layer that genuinely works.

**29. What does the brain spec cover, and when does it land?**
File 01 hands topics, positioning and facts to "the brain". Our app already has positioning, pillars, offers and a story arc built and working. We need to know whether the brain spec extends that or replaces it.
*Our recommendation:* send it as soon as it's drafted, even rough. If it replaces what we have, we'd rather know before we wire the Voice Pack into the current structure.

---

## F. Sequence

**30. Your build order, or ours?**
Yours is: storage → scan → Core intake → payoff → platform writing → Deep questions. That's right, with one change.
*Our recommendation:* move the **payoff screen earlier**, straight after storage and a minimal upload path. It's the piece that tells us whether any of this works, and it's the piece you'd demo. Better to find out in week one that a pack built from ten pasted posts doesn't convince anyone than to find out in week five.

**31. What's the deadline, and what's the first thing you need to show someone?**
It changes what we build first, and it's the only question here where we have no default.

---

## Things in the spec that disagree with each other

Small, but worth fixing in the files so nobody builds the wrong one.

1. **File 01's title still says "(v1)"**, even inside `v2-latest/`. Easy to grab the wrong one.
2. **C5 in file 05** asks for "12 to 15" words in the question text, while the format line says "min 8, max 15". Which is it?
3. **Private sources.** File 06 routes chat and email into `samples.md`, and also says no facts may leave them. See question 12 — these can't both hold.
4. **`voice.json` version numbers.** The example in file 01 is `"version": 3`; the template is `"version": 1`. We'll treat it as a counter starting at 1 unless it means something else.
5. **The anti-AI list is missing from the precedence order** in file 07. See question 17.
6. **contexts.md tags.** The spec has `measured`, `inferred`, and — in the Default block only — `derived`. We'll treat `derived` as `inferred` unless you meant a third state.

---

## What we're starting on now, without waiting

None of this changes based on how you answer.

1. **Pack storage and versioning.** Per-person, isolated, every save a new version, a readable diff between any two. Question 1 changes what it points at, not how it works.
2. **The measurement engine.** Every metric in file 06 section 4, computed in code, with a count and a quote stored behind each number. This is the part that separates Richa's file from Rohan's, it's pure computation, and it's testable against her corpus the moment it arrives.
3. **`voice.json` and the deterministic checks.** Banned words, punctuation, length range, sentence distribution, signature-phrase rationing. No model call, instant, and it's the floor under the voice check.
4. **The upload and paste path** for every source type, since that route needs nobody's permission.

Answer in whatever form suits you — a numbered reply is easiest. **1 and 2 are now settled and built** (a voice belongs to a person; the pack replaces the old voice step). The three still marked BLOCKING — **7, 8 and 9**, on sources, scraping and who the data controller is — are the ones where we'd otherwise be guessing at something expensive to undo, and 7 in particular sets the timeline.
