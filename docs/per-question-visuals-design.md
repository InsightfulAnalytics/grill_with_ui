# Per-question visuals and a collapsible discussion panel: design (decided 2026-10-30)

In this fork, Visualize stops drawing one visual for the whole grill and draws a **question
visual** for one question at a time: the page as decided so far, with that question's region
drawn once per option, and an option switcher to flip between them. Questions and Visualize
become two modes of the same page, toggled from the header, and the question list stays
visible in both, so you can walk the grill question by question while looking at visuals.
Visuals are drawn on demand, with an opt-in Auto-visualize switch. The right-hand Discussion
panel collapses to a rail and opens on demand or when something you asked for lands. Grilled
on the grill-with-ui page on 2026-10-30 (15 questions, 2 of them durable). Every
recommendation was accepted except three: Q1 (A over the recommended B, because the fork no
longer tracks upstream), Q6 (C over A) and Q12 (D over B). No visual was drawn during this
grill, so none is linked here.

## Terms

- **Question visual**: a visual scoped to one question, drawing each of its options as a
  variant. _Avoid_: per-question mockup, preview.
- **Variant**: one option's rendering inside a question visual. _Avoid_: version, draft.
- **Version**: one regeneration of a question visual, numbered from 1 per question, each with
  a one-line change note (upstream's meaning, now per question). _Avoid_: revision, draft.
- **Whole design**: upstream's grill-wide visual, drawn from every question at once; dropped
  in this fork. _Avoid_: main visual, global visual.
- **Discussion panel**: the right-hand panel holding a question's thread and its Explore
  deeper table; its composer reads "Dig deeper on Qn". _Avoid_: dig deeper section, sidebar,
  chat.
- **Auto-visualize**: a per-grill switch, off by default, under which new questions the agent
  judges visual are drawn as their round is published. _Avoid_: auto-draw, auto-update.
- **Assumed region**: a part of a visual drawn from a recommendation whose question is still
  open, marked as such (upstream's meaning, unchanged). _Avoid_: placeholder.

## Why

In the user's words:

> When I click visualise the issue is it might not visualise every single question but for my
> Power BI work it's very important that I'm able to visualise every single question
> individually so we need this feature built in somehow so Visualize is exclusive to a single
> question so I can switch between the question mode and the Visualize mode and I can switch
> between my options within Visualize and see how each answer would change the visualization
> for that individual question.

> On the right-hand side, the dig deeper section takes up too much space on the grill with UI.
> It takes up half the screen and I just don't find that I actually use it very much at all.
> [...] I still want to be able to have the dig deeper section but maybe it can be tucked away
> and expandable so it doesn't actually take up any room on the screen but if I click it then
> it expands onto the screen and then I can use it.

And on upstream: "don't worry about future merges with jason's skill repo, this is our repo
fork now." This fork (InsightfulAnalytics/grill_with_ui) is independent of
jasonku09/grill-with-ui; upstream merge cost is not a design constraint.

Today's state, for reference: the header's Visualize button draws one visual per grill
(`state.visual`, one `<session>/visual.html`, served at `/visual`), which covers the question
list and card columns when shown; the right panel (`aside`, a fixed `33vw` grid column) holds
the selected question's thread, its Explore deeper pros and cons table, and in Visualize the
visual's own feedback thread (`visual.thread`).

## Locked decisions (don't re-litigate)

### 1. Question visuals only; the grill-wide visual is removed (Q1)

Visualize always draws the selected question. There is no grill-wide visual and no Whole
design view. Finish exports one file per visualized question (see Q11).

| Option | User experience | Technical correctness | Risk | Cost |
| --- | --- | --- | --- | --- |
| **A. Question visuals only** | **mixed** | **good** | **poor** | **good** |
| B. Question visuals plus the whole design | good | mixed | good | mixed |
| C. Question visuals during the grill, whole design at Finish only | mixed | mixed | mixed | good |

The ratings are as recorded before the answer. A's poor risk rested entirely on upstream
merge cost (rewriting the visual code upstream keeps changing, so every merge there would
conflict); the user ruled that out of scope, which removes the reason B was recommended. A's
remaining weakness is UX: there is no single view of how all decisions combine. Q5 recovers
most of that by drawing every question visual on the page as decided so far.

What it means for the code:

- `state.visual` and `<session>/visual.html` go. Each question carries its own visual state,
  with upstream's fields moved under the question: `kind`, `version`, `at`, `note`, `stale`,
  `drawing`, `queued`. Its file lives at `<session>/visuals/<qid>.html` and is served at
  `/visual?q=<qid>&v=<version>` with the same `content-security-policy: sandbox allow-scripts`
  header `/visual` uses today.
- `visual.thread` goes; feedback lives in the question's own thread (Q9).
- The `visualize` and `visual-feedback` send actions gain a `q` field naming the question.
- `validateState`, `applyPatch` (the `visual` merge and `VISUAL_APPENDS`), `stampTimes`
  (`visual.at` on a version change, `drawing.since`) move to the per-question shape.
- A legacy top-level `visual` key in an old session is ignored by the page, not rejected by
  the validator (see Verified facts).

Rejected:

- **B. Question visuals plus the whole design.** Recommended at the time for keeping
  upstream's code intact and a page-level view. Lost because upstream merge cost no longer
  counts, and two kinds of visual mean two version counters, two staleness rules and more
  SKILL.md rules to keep consistent.
- **C. Whole design at Finish only.** No page-level view mid-grill anyway, plus a Finish
  draw of a visual nobody reviewed; it keeps most of A's cost with less of its simplicity.

### 2. One file per question, every variant inside, with an option switcher (Q2)

One draw writes all of a question's options from a shared baseline into one self-contained
file. An option switcher (A / B / C) in the visual strip flips between variants instantly,
without reloading the iframe.

| Option | User experience | Technical correctness | Risk | Cost |
| --- | --- | --- | --- | --- |
| **A. One file per question, every variant inside** | **good** | **good** | **mixed** | **mixed** |
| B. One file per option, drawn on first look | poor | mixed | good | good |
| C. All options side by side | mixed | good | good | mixed |

A's weakest axes are risk and cost: one draw renders every option, including ones you would
never look at, and a failed draw loses all variants at once rather than one. With two to four
options per question that cost is bounded.

What it means for the code:

- The iframe is sandboxed without `allow-same-origin`, so the page cannot reach into it. The
  switcher drives it with `postMessage({ variant: "B" })`, and the visual listens for that
  message; as a fallback the page may set the iframe's URL fragment (`#B`) and the visual reads
  `location.hash` on load. `visual-brief.md` must require both, so an exported file opened on
  its own also responds to `#B`.
- The visual strip carries the switcher, marked: the recommended option tagged Recommended,
  the recorded answer ticked, the staged answer in the staged colour. It opens on the staged
  answer, else the recorded answer, else the recommendation (Q7).
- A question with no options (`rec.text`) has one variant, the recommendation. A question
  answered with free text gains a **Your answer** variant on its next redraw.
- Only this question's region varies between variants; it is outlined so the eye finds it
  (Q5).

Rejected:

- **B. One file per option, drawn on first look.** You wait on every first switch, and
  variants drawn in separate runs drift in layout, so the comparison picks up noise.
- **C. All options side by side.** Easy to compare, but a 16:9 report page shrunk to a
  quarter of the frame is unreadable.

## Routine choices

- **Discussion panel** (Q3, A): collapses to a slim rail on the right edge showing the
  message count; a click expands it to today's width (the card narrows), another click
  collapses it. The state is remembered across reloads (page-local storage, like the theme).
  It applies in both modes; in Visualize a collapsed panel gives the visual the full width
  beside the question list. Rejected: an overlay drawer (covers the options you are writing
  about), inline under the card (scrolls away from the options, and Visualize feedback has no
  home), narrower and resizable (still takes room, which was the complaint).
- **Moving between modes** (Q4, A): a Questions / Visualize toggle in the header replaces
  today's Visualize button. The mode is sticky: the question list stays visible in both
  modes, and picking another question while in Visualize shows its visual, or a **Visualize
  QN** button where it has none yet. In Visualize, the visual takes the card's column.
  Rejected: a per-question flip that hides the list (back out to change question); the
  visual above the card with no modes (a 16:9 page and four options do not fit one column).
- **What surrounds the option** (Q5, A): a question visual draws the page as decided so far.
  Other questions are drawn as answered, or as recommended and tagged as an assumed region if
  open; only this question's region changes between variants, outlined. Accepted cost: every
  question visual renders the full page, so draws grow as the design grows, and two question
  visuals drawn at different times can show the rest of the page slightly differently.
  Rejected: the element alone (hides how it sits on the page); agent picks per question
  (unpredictable).
- **When a question visual is drawn** (Q6, C): on demand, plus an **Auto-visualize** switch,
  off by default. On demand means the Visualize QN button, or switching to Visualize on a
  question with no visual. Chosen over the recommended on-demand-only option. Rejected: every
  new question drawn automatically with no switch (draws everything; inline it blocks every
  round).
- **Answering from Visualize** (Q7, B): the switcher only previews; a **Choose B** button
  beside it stages B exactly as clicking the option card would, and Send ships it. On a
  `multi` question, Choose toggles that option in the staged set. Rejected: preview only
  (back to the card for every answer); switching is answering (cannot browse without
  staging).
- **Panel opening by itself** (Q8, A): it opens when you click Explore deeper, and when an
  agent reply or Explore table lands on the question you are looking at; otherwise it stays
  as you left it. The rail shows an unread dot when another question has something new. A new
  grill starts with the panel collapsed. Rejected: never opening by itself (Explore deeper
  looks broken); opening on anything new for any question.
- **Feedback on a question visual** (Q9, A): it goes into the question's own thread, one
  thread per question. A note written in Visualize lands there tagged **on the visual** and
  asks for a redraw; the composer button in Visualize reads **Add feedback and redraw**, in
  Questions it stays **Add to discussion** and never redraws. Upstream's rule carries over:
  a note that contradicts an answered question reopens that question with the note quoted and
  the recommendation rewritten; the answer changes only when the user answers again.
  Accepted risk: whether a message redraws depends on the mode it was typed in, so the label
  must say so. Rejected: a separate visual thread per question (two threads per question, a
  second thread kind in the state).
- **When a question visual is out of date** (Q10, C): the agent judges, per visual, after
  each send, and marks a question visual out of date when the change shows on that visual's
  page (it shows the whole page, per Q5). Out of date never redraws by itself; Regenerate
  does. Accepted: a judgement can miss one (Regenerate fixes it), and the agent spends a
  little reasoning per visual per send. Rejected: only its own question or `deps` (misses
  page-level changes); any decision (every visual stale every send, so the mark means
  nothing).
- **Finish export** (Q11, A): one file per visualized question in
  `docs/<slug>-visuals/<qid>.html`, each opening on the chosen variant with the others still
  switchable, each linked from its decision in the doc. Rejected: one gallery file (a build
  step at Finish, every visual behind one escaping bug); chosen variant only (throws away the
  comparison).
- **Which questions Auto-visualize draws** (Q12, D): the questions the agent judges visual;
  it skips questions with little to show, such as a timing rule. Chosen over the recommended
  "all but Skim". Accepted: you cannot predict which questions get drawn; the rest stay one
  click away. Rejected: every new question (draws Skim questions you accept unread), all but
  Skim, Decide carefully only.
- **Several draws at once** (Q13, A): in parallel across questions, one at a time per
  question. Each question's draw is its own background subagent; a second request for the
  same question queues in that question's `queued`. Inline (no subagent tool, or Use
  subagent unticked), the round is published first and each question drawn after it in turn,
  with Send held until they finish. Accepted risk: each question tracks its own draw, and one
  stuck draw must not hold the others. Rejected: one queue across all questions (the third
  question waits behind two); Auto-visualize disabled without subagents (it would be off in
  sessions like the one this grill ran in).
- **Prototype or diagram** (Q14, A): the agent picks per question: prototype when the
  question changes something you see, diagram otherwise; feedback can switch it ("make this a
  diagram"). Rejected: one kind per grill (forces rule questions onto a page); the user picks
  per question (a chore for an obvious call).
- **Out-of-date visuals at Finish** (Q15, C): the Finish confirm lists the out-of-date
  question visuals with a **Redraw them first** box, ticked by default. Ticked: redraw each,
  then export (the doc and its visuals agree). Unticked: export them as they are with a
  banner naming the decisions they predate. Questions never visualized are not drawn at
  Finish. The `finish` action carries the box's value. Rejected: always redraw (pays for
  redraws when only the doc matters); always export as is (visuals can contradict the doc).

## Verified facts

- Only two sessions in `~/.grill-with-ui/sessions` have a grill-wide `visual` (Gantt
  showcase report; DAX Measure Tree v1 build plan), and both are finished with the visual
  already exported to their docs. No unfinished session has one, so no migration is needed;
  the page ignores a legacy top-level `visual`.
- The session this grill ran in had no subagent tool, so all draws there would have been
  inline. That is why Q13's inline path and Q6's switch both have to work without subagents.
- Files the change touches: `page.html` (the body grid's `33vw` third column, `#visual`,
  `renderVisualizeButton`, `renderVisual`, `renderAside`, `renderFeedback`, the narrow-screen
  media query), `server.mjs` (the `/visual` route, `validateState`, `applyPatch`,
  `stampTimes`), `SKILL.md` (Visualize, Subagent or inline, Handling a send, Finish step 3,
  the state.json schema and send lines), `visual-brief.md` (variants, region outline,
  switcher protocol, page context), `README.md`, and the tests that reference the visual:
  `server.test.mjs`, `page.e2e.mjs`, `manual-visual.e2e.mjs`, `subagent-toggle.e2e.mjs`.

## Risks

- **Draw size grows with the design** (Q2, Q5): every question visual renders the full page
  and every variant. Late in a long grill a draw is large and slow, most of all inline.
- **Visuals drift from each other** (Q5): two question visuals drawn at different times can
  show the rest of the page differently. The agent's out-of-date marks (Q10) bound this, but a
  missed mark leaves a visual quietly behind.
- **Unpredictable Auto-visualize** (Q12): the agent's judgement of what is visual may skip a
  question you wanted drawn, or draw one you did not need.
- **Concurrent draws** (Q13): several subagents writing different files at once; per-question
  drawing state must be patched without one draw's completion clobbering another's. Patches
  are atomic per call, so each completion must patch only its own question.
- **Mode-dependent composer** (Q9): the same panel's composer redraws in Visualize and does
  not in Questions; the button label is the only guard.
- **Inline sessions hold Send** (Q13): with Auto-visualize on and no subagents, every round
  holds Send for all its draws.

## Deferred

None.

## Open threads

- **Narrow screens.** Below 760px the panes already stack. Not grilled: the proposal is
  that the Discussion panel becomes a collapsed "Discussion (n)" section under the card,
  following Q3 and Q8, and Visualize shows the visual full width above the list.
- **Exact state shape.** Not grilled: the field names under each question (proposed:
  `questions[].visual` with upstream's fields, `autoVisualize` at the top level, a thread
  message tag such as `"on": "visual"`) and how the Auto-visualize switch reaches the agent
  (proposed: an immediate `auto-visualize` send action, like Explore deeper, which the agent
  records in state).
- **Use subagent checkbox.** It stays and still applies per draw; with Auto-visualize, the
  agent uses the value from the switch's send. Not grilled.
