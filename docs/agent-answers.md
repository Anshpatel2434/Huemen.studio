# Agent answers (OpenUI)

The agent panel ("Ask Huemen...") answers questions with cards and buttons
instead of a paragraph. "Plan my week" comes back as a week of post slots, each
with a Draft button; "What's missing from my brief?" comes back as a score and
a checklist with a link to fix each gap.

## How it works

1. **Commands first.** `askAgent` (`src/app/w/[id]/p/[pid]/agent-actions.ts`)
   still runs direct commands at once: "Write a LinkedIn post about...",
   "Add pillar...", "Idea: ...". Anything else is a question.
2. **Questions stream.** The panel posts the question to
   `POST /w/[id]/p/[pid]/agent/stream`. The route builds the prompt the one way
   every generation is built (INV-2): template `agent_answer` (admin-editable),
   plus the brand context, plus the task (the question, the project, the
   brief's gaps). It goes through the AI facade, so the usage cap, provider
   choice and `generation_logs` row all apply.
3. **The answer is OpenUI Lang**, a small language that arranges a fixed set of
   Huemen components. The panel renders it with `@openuidev/react-lang` while it
   streams, so the structure appears first and fills in.
4. **Buttons run fixed actions.** A component decides what its button does
   ("Draft this" drafts, "Open" opens a page); the model only fills in props.
   Writes go to `runAgentAction`, which validates the action again
   (`src/lib/agent-ui/actions.ts`) before anything runs.

## Files

| File | What it holds |
|---|---|
| `src/lib/agent-ui/spec.ts` | The components, their props and descriptions, the pages the agent may open, the action types. React-free: the server prompts and parses with it. |
| `src/lib/agent-ui/library.tsx` | One renderer per component, in Huemen's theme tokens. Built from the spec, so it cannot draw anything the model was not told about. |
| `src/lib/agent-ui/prompt.ts` | The output contract (spec, rules, two examples), the task text, and the parser check. |
| `src/lib/agent-ui/actions.ts` | The allow-list for button actions. |
| `src/lib/agent-ui/mock.ts` | The stand-in's answers, so the whole flow works with no key. |
| `src/app/w/[id]/p/[pid]/agent-panel.tsx` | The panel: streaming, rendering, actions. |
| `src/app/w/[id]/p/[pid]/agent/stream/route.ts` | The streaming endpoint. |

## Components

Answer (root), Heading, Para, Bullets, Note, ScoreBar, Checklist, CheckItem,
IdeaCard, WeekPlan, PlanSlot, PillarCard, HookOptions, OpenPage, FollowUps.

To add one: add its props and description in `spec.ts`, its renderer in
`library.tsx`, and a stand-in use in `mock.ts`. The tests check that every
stand-in answer parses cleanly and that the drawn library matches the spec.

## Decisions

- **Only Huemen components.** None of OpenUI's general components (HTML view,
  maps, images from the web, YouTube, native selects and date pickers) are
  used. Nothing in an answer can show content from outside the app or break
  the no-system-UI rule.
- **The spec is in the cached system part** of the prompt, between the template
  and the brand context, so it is paid for once per cache window, not per
  question.
- **No OpenUI Cloud.** Answers come from Claude through the existing AI facade.
  Without Cloud's correction step, the route checks each finished answer; one
  that does not parse shows a plain "ask it another way" line, and the failure
  is logged to stdout as `agent_answer_invalid` with the error codes only.
- **Telemetry off.** `@openuidev/lang-core` sends anonymous install telemetry
  from its postinstall script unless `OPENUI_TELEMETRY_DISABLED=1` is set; it is
  in `.env.example` and must be set in the build environment of every host.
  Runtime telemetry is opt-in and not enabled. OpenUI's development inspector
  (which loads a script from jsDelivr and shows a Cloud banner) is switched off
  by `src/lib/agent-ui/no-devtools.ts`; production builds never include it.
- **Route:** answers use the strong text route (the writing model). A wrong
  plan or a weak hook costs more than the few cents an answer costs.
