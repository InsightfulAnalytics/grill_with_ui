---
name: grill-with-ui
description: Run a grilling interview on a local browser page instead of the terminal. Every question is laid out with its recommendation, answerable in any order, with a per-question discussion thread and one "Send to Agent" button. Use when the user says "grill with ui", invokes /grill-with-ui with a topic, or says "/grill-with-ui resume".
---

# grill-with-ui

`$SKILL` below means this skill's base directory (the folder holding this file). Everything is
plain Node with no install step: `node $SKILL/server.mjs <command>`.

Two files carry a grill. `state.json` is **yours alone**: questions, recommendations, thread
replies, statuses, agent status. `events.jsonl` is **the page's alone**: one line per Send.
Nobody writes the other's file. The page polls `state.json`; how you receive events depends
on the listening mode below.
The question visuals, one file per question under `<session>/visuals/`, are also yours (see
[Visualize](#visualize) for drawing).

## Listening mode and turn boundaries

Choose the mode from the tools actually available, not the agent's model name:

- **Persistent Monitor:** if the harness delivers its events to the agent even after a turn
  ends, publish the update and end the turn; the next event wakes you.
- **Wait mode (no persistent Monitor):** a running page server or background shell process
  does **not** wake a finished agent turn. Keep the turn active and return to the foreground
  `wait` loop after opening the page, handling every send, and every draw completion or
  failure. A tool returning a process/session ID is not an event subscription: resume that
  process with the harness's polling tool. Do not send a final response merely because a
  question round or visual is ready. A timeout means wait again, not end the interview.

Throughout this skill, **return to listening** means the appropriate action above. In wait
mode stop only after Finish and any final visual export are complete, the user explicitly
pauses/stops the interview, or a tool failure prevents continuing. If you must stop, say that
the listener is inactive and that browser submissions will be queued until resume; never
claim you are still listening. On resume, drain `pending` as Resume step 3 describes before
waiting for new events.

**You change `state.json` only through `patch`** (next section), never with a file-write or
edit tool. A whole-file write puts the entire state into this conversation on every turn, and
the state grows with the grill: after twenty sends one rewrite is about 60 KB, some 15k
tokens, paid again on every send. A patch carries only what changed. Below, "set" and
"append" mean a key in a patch, and `null` is how a key is deleted.

## Patching state.json

```sh
node $SKILL/server.mjs patch --session <session> <<'GRILL_PATCH'
{ …only what changed… }
GRILL_PATCH
```

The delimiter is quoted, so the shell expands nothing inside it. (`--file <path>` reads the
patch from a file instead, for harnesses where heredocs are awkward.) It merges the patch,
validates the result, and swaps the file in atomically, so the page sees one consistent
update per patch. It works whether or not `serve` is running. It prints one line,
`{"ok":true,"questions":12,"open":3,"handled":14,"bytes":41233}`, never the state. A bad
patch exits non-zero with a one-line error and leaves the file untouched: fix the patch and
run it again.

The patch is shaped like `state.json` (schema at the end):

- `null` deletes a key, at any level: `"answer": null`, `"drawing": null`, `"visual": null`.
- `agent` merges one level: keys you give replace those keys; the rest stay.
- `questions` is keyed by `id`. A known id merges one level: each field you give replaces
  that field whole (`rec`, `answer`, `options`, `deps`, `explore`), except `visual`, which
  merges one level itself. An unknown id is a new question, appended; it needs `round`,
  `title`, and `rec` (give `body` and `options` too); `status: "open"`, `deps: []`,
  `options: []`, `thread: []`, `durable: false`, and `updated: false` are filled in (`level`
  is not: give it). An unknown id without `title` is an error, not a new question (ids are
  case-sensitive: `q7`, never `Q7`).
- A question's `thread`, and its visual's `queued` and `staleBy`, append: list only the new
  messages, bullets, or ids.
- `terms` is keyed by `term`: a known term is replaced whole, a new one appended.
- There is no top-level `visual`: a patch that gives one is rejected (`"visual": null` only
  clears an older grill's). Visuals live on their question.
- Every other key (`note`, `intent`, `finished`, `doc`, `autoVisualize`, …) is replaced whole.

**Never write the current time; the server stamps every time you leave out**: `agent.since`
whenever you give `agent.status`, `at` on each appended message, `explore.at`, a question
visual's `at` when its `version` changes and its `drawing.since`, and `finished.at`. A time
you give always wins; give one only when copying it from a send line (a user's thread
message takes the send's `at`).

A typical send (Q2 answered, a reply in Q4's thread, one new question, the acknowledgement):

```sh
node $SKILL/server.mjs patch --session <session> <<'GRILL_PATCH'
{
  "agent": { "status": "waiting", "handled": 5 },
  "questions": [
    { "id": "q2", "status": "answered", "answer": { "kind": "option", "option": "B" }, "updated": false },
    { "id": "q4", "thread": [
      { "who": "user", "text": "Why not keep staged answers in localStorage?", "at": "2026-09-18T21:39:58Z" },
      { "who": "agent", "text": "localStorage is per browser profile, so a second browser or a cleared profile loses them. The session folder survives both, at the cost of one more file." } ] },
    { "id": "q7", "round": 4, "deps": ["q2"], "title": "Who owns the retry budget?",
      "body": "With the server-side queue settled in Q2, retries need an owner.",
      "level": "check", "levelReason": "high stakes, clear answer",
      "options": [ { "k": "A", "text": "Each queue row counts its own retries",
                     "ratings": { "ux": "good", "correct": "good", "risk": "mixed", "cost": "good" } },
                   { "k": "B", "text": "One counter per device",
                     "ratings": { "ux": "mixed", "correct": "poor", "risk": "poor", "cost": "good" } } ],
      "rec": { "option": "A", "why": "A row owning its count needs no join, and one bad device cannot starve the rest. Its weakest axis is risk: there is no global cap." } }
  ]
}
GRILL_PATCH
```

## Start (`/grill-with-ui <topic>`, `$grill-with-ui <topic>`, or "grill with ui: <topic>")

1. From the project directory run
   `node $SKILL/server.mjs new --topic "<topic>" --intent "<why this grill exists, 1-2 sentences>" --doc "<doc path>"`.
   The doc path defaults to `docs/<slug-of-topic>-design.md` under the project root (create the
   folder later if needed). Pass `--intent` with the user's goal in their words (1-2 sentences),
   taken from the topic message that started this grill. The topic is the title; the intent
   is the why. Omit it only when the topic arrived as a bare phrase with no goal attached.
   The page shows it under the topic so several open
   grills stay distinguishable. It prints one JSON line; keep `session` (the session folder).
2. Patch round 1 in (`new` already wrote the skeleton): one to three independent questions,
   each with lettered options, a level, ratings, one recommendation, and a one-paragraph why
   (see Interview method), plus any `terms`, `axes` if the default four do not fit the topic,
   and `"agent": { "status": "waiting" }`.
3. Open a **persistent Monitor** (`persistent: true`) whose command is
   `node $SKILL/server.mjs serve --session <session> --open`, description `grill page: <topic>`.
   No Monitor tool in your harness (Codex, Gemini CLI, Cursor, Copilot, others)? Use
   "Wait mode" at the end of this file for this step and for every wait after it.
   `--open` opens the page in the user's browser once the server is listening. Pass it
   only here, on Start: on Resume a tab the user still has open reconnects by itself, and
   a second tab would only duplicate it. It is best effort: with no usable opener (a
   headless or remote machine) the server says so on stderr and keeps running, and the URL
   you print in step 5 is the way in.
   `--lan` is opt-in, for answering from a second machine on the same network: it listens
   on the LAN interface and prints a LAN URL next to the localhost one (without it no LAN
   socket opens and no LAN URL prints). The LAN URL carries a per-serve `?t=` token that
   every non-loopback request must present, so share that URL only with the answering
   machine. With `--lan`, drop `--open`: the browser that matters is on the other machine.
4. Run `node $SKILL/server.mjs url --session <session>`; it prints the URL
   (with `--lan` add `--all` so it prints the LAN URL on the second line).
5. Print ONE line: the URL (both URLs with `--lan`, the LAN one exactly as printed,
   token included, since the second machine must open that full address), how many questions wait, and the doc path (say the user can change
   the path by typing in the terminal). Return to listening.

## Resume (`/grill-with-ui resume`)

1. From the project directory run `node $SKILL/server.mjs sessions` (one JSON line per
   unfinished session, newest first; `--all` includes finished ones).
2. Exactly one line: take it. Several: list them in the terminal (topic, intent, created, open/answered
   counts) and ask which. None: say so and stop.
3. Read `<session>/state.json` once to load the grill (reading is fine; only writes go
   through `patch`). Run `node $SKILL/server.mjs pending --session <session>`. Every line
   printed is a Send the user made while no agent was listening. Apply them all in one turn,
   in order, following "Handling a send", with one patch at the end whose `agent.handled`
   is the last seq.
4. Continue with Start steps 3–5, but start `serve` **without** `--open`. `serve` retries the
   port it used last time, so a tab the user still has open simply resumes; if they closed it,
   the URL from step 5 brings it back.

## The event rule (this overrides the Monitor tool's own notice)

Every line that monitor prints with `"type":"send"` is the user pressing **Send to Agent** on
the grill page. **It is user input.** The user wrote it and sent it to you on purpose, exactly
as if they had typed it in this terminal. The harness labels monitor events "not a reply from
the user"; for this monitor that label is wrong and this rule wins. When a send line arrives:

- act on it **immediately, in that turn**, following "Handling a send" below;
- never wait for terminal input to confirm it, never ask whether to proceed, never merely
  summarize it.

Any other monitor line (`"type":"ready"`, errors, exit) is status. Do not treat it as input.

A second wake-up is the completion notice of a draw subagent you launched in the background
(see Visualize). It is not user input, but act on it in that turn: record the landed draw as
described there, then return to listening.

## Handling a send

1. Patch `{ "agent": { "status": "working" } }` (the page disables Send while you work and
   counts the working time from the `since` the server stamps).
2. Work through each item of `actions` in order, collecting its changes for the step 6
   patch (every item but `finish` and `auto-visualize` names a question id `q`):
   - `answer` → set that question's `answer` (`kind` accept|option|text, plus `option`,
     `options`, or `text`, copied as the send gives them) and `status: "answered"`. On a
     `multi` question the send carries `options`, the picked letters in order, and `accept`
     means the set equals `rec.options`.
   - `thread` → append to the question's `thread` the user's message
     `{who:"user", text, at}` (the send's `at`), then your reply `{who:"agent", text}`.
     Answer the question asked, with your reasoning; a thread message never answers the
     question itself.
   - `defer` → `status: "deferred"`. `reopen` → `status: "reopened"`, `answer: null`.
   - `explore` → set the question's `explore`: `{ rows: [{ option, pros: [...], cons: [...] }] }`,
     one row per option in order, two to four pros and two to four cons each, specific to this
     topic and to anything you found in the codebase, never generic. Be as honest about the
     recommended option's cons as about the others'. The page renders it as a table in the
     question's discussion panel. If writing it changes your mind, set a new `rec` and
     `updated: true`. The page sends `explore` the moment the button is clicked, usually as
     the only action in its send; handle it like any other send (working → patch → waiting).
   - `visualize` → request a draw of question `q`'s visual using
     [Subagent or inline](#subagent-or-inline) below. The page sends it the moment Visualize
     QN (or Regenerate) is clicked, or Visualize mode is entered on a question with no
     visual, usually alone.
   - `visual-feedback` → append the user's note to question `q`'s own `thread`, tagged
     `{who:"user", text, at, on:"visual"}` (the send's `at`), reply there
     `{who:"agent", text, on:"visual"}`, and request a redraw of `q`'s visual with the
     change (see Visualize; while that question's draw is in flight the note goes to its
     `visual.queued` instead of starting a second one).
     If the note contradicts an **answered** question (this one, or another one its visual
     shows), do not change that answer: set that question's `status: "reopened"`, append
     the quoted note to its `thread`, set its `rec` to what the note implies, and set
     `updated: true`. The answer changes only when the user answers the reopened question.
     The visual follows the note either way.
   - `auto-visualize` → set `"autoVisualize": { "on": <on>, "subagent": <subagent> }` (see
     [Auto-visualize](#auto-visualize)). It arrives alone, the moment the switch is clicked.
   - `finish` → see Finish below, after the other actions. For what the page includes when
     the user confirms, see [README: Use](README.md#use).
3. If an answer changes the recommendation of a still-open question, give that question its
   new `rec` and `updated: true` (the page marks it). Set `updated: false` once the user
   answers it.
4. Add the next round: the frontier (see Interview method), up to three when independent,
   each a new question entry with `deps` listing the question ids it depends on. New
   questions get the next round number. If the tree is fully walked, add no questions and
   set `note` to a short sentence saying every branch is settled and Finish is the next step.
5. **Ordinary turns do not redraw visuals.** After the send's changes, judge each existing
   question visual on its own: it draws the whole page as decided so far, so an answer,
   reopen, or changed recommendation on *any* question can show on it. When one does, set
   that question's `"visual": { "stale": true, "staleBy": ["<id of the question that
   changed>"] }` (`staleBy` appends; skip an id already there). When a change does not
   show on a visual's page, leave that visual alone, whatever `deps` say. Leave the file,
   `version`, `at`, and `note` unchanged;
   the page marks it out of date and the user clicks **Regenerate** when ready. Do not draw
   merely because the next round is ready. Explicit `visualize` and `visual-feedback`
   actions still request a draw, [Auto-visualize](#auto-visualize) draws new questions
   when it is on, and Finish still reconciles the exported visuals.
6. Send everything from steps 2–5 **in ONE patch**, together with
   `"agent": { "status": "waiting", "handled": <seq of this send> }`
   (the example under "Patching state.json" is this patch). One patch is one atomic swap,
   so the page sees the answers, thread replies, next round, and acknowledgement together.
   Never publish the next round in one patch and `handled` in a later one while you do
   optional work: the page uses `handled` to clear the previous question's "sent" spinner
   and enable the next Send.
7. Print exactly one terminal line, e.g.
   `grill: handled send #3 (Q2 → B, Q4 thread); round 4 has 2 questions; Q1 visual out of date`,
   and return to listening.

## Interview method (frontier per round)

Interview the user relentlessly about every aspect of the topic until you share an
understanding, walking each branch of the design tree and resolving dependencies between
decisions in order:

- A question is asked only when its prerequisites are settled. Each round is the current
  **frontier**: the questions that can be asked now. Ask up to three per round when they are
  independent of each other; one when they are not. Record each question's `deps`.
- Every question has a `title`, a `body` that states what hangs on it, lettered `options`
  (two to four), and `rec` with the recommended option and a one-paragraph `why` that names
  the trade-off. A question with no sensible options has `options: []` and `rec.text`.
- The page renders inline markdown only: bold, italics, `code`, and http(s) links. Block
  markdown (lists, tables, headings, code blocks) shows as raw text, so write prose.
- Every question has a `level`, how much of the user's attention it deserves, from
  **stakes** (how costly a wrong pick is: hard to reverse, far-reaching) and **closeness**
  (how near the call is between the options), plus a `levelReason` saying which drove it:
  - `skim`: low stakes, whatever the closeness (`"low stakes"`).
  - `check`: high stakes, clear answer; the user reads the why and confirms
    (`"high stakes, clear answer"`).
  - `careful` (Decide carefully): high stakes, close call; this is where their time goes
    (`"high stakes, close call"`).
  - `yours` (Your call): pure preference you cannot judge, such as naming, wording, or taste.
    The page shows your pick as **My lean**; still give `rec`, and picking it is an accept.
- Rate every option of every question, except Your-call ones, on the grill's **axes**:
  `ratings: { "<axis key>": "good|mixed|poor|na" }`, `na` where an axis does not apply. The
  page shows them as coloured chips under the option. The default axes are `ux` (user
  experience: how it feels to the person using it), `correct` (technical correctness: works
  as intended, fits the system, not a burden to maintain), `risk` (what can go wrong and how
  badly, including lock-in), and `cost` (the recurring bill each time it runs: money,
  tokens, latency; never build effort). Replace them only when they clearly do not fit the
  topic (a pricing grill, a promo video), once, in the round 1 patch:
  `"axes": [{ "key": "reach", "name": "Reach" }, …]`. Never change them mid-grill.
- Keep ratings and recommendation honest with each other. The `why` names the
  recommendation's **weakest axis** and what it gives up there ("Its weakest axis is risk:
  leaving the format later is a migration"), saying whether a poor `risk` means "could
  break" or "hard to undo". When the pick is best or tied on every axis, say so plainly ("best
  on every axis; it costs nothing here") rather than inventing a weakness; such a question is
  not a close call, so it is never `careful` on closeness grounds. A Your-call question has no
  ratings (`patch` rejects them): the axes do not separate its options.
- When the options do not exclude each other and the user may want any mix of them (which
  channels to support, which checks to run, which roles get access), set `multi: true` and
  recommend a set: `rec.options: ["A","C"]` instead of `rec.option`. The page lets the user
  toggle any number of options. Keep single choice whenever picking one rules out the
  others; never use `multi` to dodge a real trade-off, and never offer an "all of the above"
  option on a `multi` question.
- If a question can be answered by exploring the codebase or the docs, explore instead of
  asking, and mention what you found in the next question's body.
- Maintain `terms` as vocabulary settles: `term`, one-sentence `def`, and `avoid` (words
  not to use for it). Use the terms consistently in later questions.
- Set `durable: true` on a question whose decision passes all three gates: hard to reverse,
  surprising without context, a real trade-off. Everything else is a routine choice.
  `durable` shapes only the doc (see Finish); the page shows the level, never `durable`.
- Stop asking when the tree is walked. Say so with `note`; do not pad with filler questions.

## Visualize

Visualize draws a **question visual**: one artifact for one question. It shows the page (or
the system) as decided so far, with that question's region drawn once per option; each
option's rendering is a **variant**, and all of them live in one file. The page has two
modes, Questions and Visualize, toggled in the header. In Visualize the selected question's
visual takes the card's column beside the question list, with an option switcher that flips
between variants without a reload and a **Choose** button that stages the previewed option,
exactly as clicking its card would. There is no grill-wide visual.

Pick the kind per question: a **prototype** when the question changes something the user
sees (a page, a panel, a flow they click through), a **diagram** otherwise (a rule, data
flow, sequence, state). Record it in that question's `visual.kind`; switch when feedback asks
("make this a diagram"). Questions are the source of truth and every visual is derived from
them, never the other way round. When the topic is an improvement or a feature in an
existing app, the prototype is drawn **in the context of that app**: the real page it lands
on, with the app's own chrome and styling, so it looks like what will actually ship. You
know where it lands from the grill; include that context in any subagent brief.

**By default you never write a visual yourself; a subagent draws it.** A file runs to
hundreds of lines and is redrawn many times over a grill. Drawing it here would fill this
session's context with markup and slow every later send. You stay the interviewer: you pick
the kind, write the brief, and record the result with `patch`. The rules for the file
itself live in `$SKILL/visual-brief.md`; the subagent reads them, you do not repeat them.
See [Subagent or inline](#subagent-or-inline) for when you draw the file yourself.

Draw only for a `visualize` action (Visualize QN, Regenerate, or Visualize mode entered on a
question with no visual), `visual-feedback`, [Auto-visualize](#auto-visualize), or the
Finish reconcile. A requested redraw brings that visual up to date with **all** current
questions, including changes accumulated since its last version, not just the triggering
send. Ordinary interview turns only mark affected visuals stale (Handling a send, step 5).

Every question's visual is its own: `<qid>` below is the question's id, `<qid>.visual` its
state, `<session>/visuals/<qid>.html` its file. Draws for different questions run **in
parallel**, one subagent each; a question has at most one draw in flight. One send that asks
for several questions (two Visualize clicks queued, feedback on two visuals, Auto-visualize
on a round of three) launches one subagent per question, together.

For subagent draws, follow these steps. **The draw runs in the background and the interview
goes on**: the send that requested it is handled the moment the brief is out, so the user
keeps answering and sending while the subagent draws.

1. Stat `<session>/visuals/<qid>.html` (do not read it) and note its modification time; a
   first draw has none. Then launch ONE subagent for the question with the Agent tool (it
   runs in the background and you get a completion notice later), general-purpose type,
   prompt filled in from this template (use the absolute path of `$SKILL`):

   > Draw the question visual for **<qid>** of a grill-with-ui design interview. Read
   > `$SKILL/visual-brief.md` first and follow it exactly. Session folder: `<session>`.
   > Project root: `<project>`. Kind: **prototype** | **diagram**.
   > Context: **change to an existing app**, landing in `<route, page, or component>`;
   > match that page's real look and surroundings. | **New UI**, nothing to match. |
   > **Diagram of existing code** in `<modules>`. | **Diagram of a new system**.
   > Variants: `A`, `B`, `C` (the options) | `rec` (no options) | plus `yours`, the
   > user's free-text answer: "<text>". Default variant: `<answer, else recommendation>`.
   > **First cut** from the questions in `state.json`.
   > *or*
   > **Redraw** of the existing `visuals/<qid>.html`. Change only what follows; keep
   > everything else stable:
   > - Q3 answered B: the discussion panel moves to the right third
   > - feedback: "make the sidebar collapsible"
   > Write `<session>/visuals/<qid>.html` and reply with ONE line saying what the visual
   > now shows (or what changed).

   One send with several triggers for the same question (feedback plus answers that change
   its visual) is one draw with all of them in the list.
2. Put the draw into the send's one step-6 patch, on that question only. On a first draw:
   `{ "id": "<qid>", "visual": { "kind": …, "version": 0, "stale": false, "drawing": { "seq": <seq> } } }`.
   On a redraw: `{ "id": "<qid>", "visual": { "stale": false, "staleBy": null, "drawing": { "seq": <seq> } } }`;
   the merge keeps `version`, `at`, and `note`, and the file stays as it is. The same patch
   finishes the send as usual (`agent.handled`, `"status": "waiting"`); print the terminal
   line with "Q3 visual drawing" in it and return to listening. The page reads `drawing`:
   on a first draw it shows "Drawing the first version of Q3…" in the visual's place and
   loads the file by itself when v1 lands; on a redraw it keeps the current version on
   screen with regenerating… in the strip. Send stays enabled throughout.
3. **While a question's draw is in flight**, handle sends normally. An answer, reopen, or
   changed recommendation that shows on that visual sets `"stale": true` as usual (the
   in-flight draw did not see it). A new draw request for **the same question** (Regenerate
   or feedback) does not start a second subagent: reply in its thread now and append the
   request as one bullet, `{ "id": "<qid>", "visual": { "queued": ["feedback: …"] } }`.
   Never run two draws of one question at once; both would write the same file. A request
   for **another** question starts that question's own draw at once.
4. **When a draw lands** (its completion notice wakes you): stat its file again (do not read
   it) and confirm it exists with a modification time later than the one you noted at
   launch. Then patch that question only:
   `{ "id": "<qid>", "visual": { "version": <version + 1>, "note": …, "variants": [ … ], "drawing": null } }`
   (0 → 1 on a first draw; `note` is one line naming what changed, taken from the
   subagent's reply: "v3: filter pane moved to the left rail per Q3"; `variants` lists the
   variant keys the file holds, from the brief). Leave `stale` out of it. Patching only the
   landed question keeps concurrent draws apart: each patch is atomic and merges one
   question's `visual`, so one draw's completion never overwrites another's state. If its
   `queued` is non-empty, use those bullets as the next draw's change list and choose its
   mode under [Subagent or inline](#subagent-or-inline). For a background draw, repeat
   step 1 and in the same patch give `"drawing": { "seq": <last handled seq> }` instead of
   `null`, plus `"queued": null`. Print one line ("grill: Q3 visual v3 landed", or "…
   landed; drawing v4 from 2 queued notes") and return to listening. Never bump without a
   new file and never let a new file land without a bump; the page reloads the iframe only
   on a bump.
5. If the subagent fails or the file did not change: on a first draw patch that question's
   `"visual": null` and append an agent message to its `thread` saying the draw failed and
   Visualize can be clicked again; on a redraw patch `"visual": { "drawing": null }` and the
   same kind of thread message. Do not bump either way. Return to listening so the user can
   retry.

### Subagent or inline

The page has a **Use subagent** checkbox in the header, checked by default. Every draw
request carries its value as `subagent`: the `visualize`, `visual-feedback`, and
`auto-visualize` actions, and the `finish` action when any question has a visual. A missing
`subagent` means `true` (an older page).

- `subagent: true` → the background subagent draw above. Background draws require a
  top-level session: a subagent's own background tasks are dropped when its turn ends.
  If you are yourself a subagent or have no subagent tool, use the inline procedure below.
- `subagent: false` → the user wants a faster draw. Draw it **inline, in this turn**: read
  `$SKILL/visual-brief.md` and write `<session>/visuals/<qid>.html` yourself, from the same
  kind, context, variants, and change list you would have put in the brief. Before you
  start, patch the question's first-draw `visual` (kind, `"version": 0`, `"stale": false`)
  or, on a redraw, `"stale": false` and `"staleBy": null`, together with
  `"drawing": { "seq": <seq> }`, so the page shows the drawing state while `agent.status`
  stays `working`. When the file is written, the send's one step-6 patch carries
  `"version": <version + 1>`, the `note`, `variants`, `"drawing": null`, and the usual
  `agent.handled` and `"status": "waiting"`. Send stays disabled while you draw; that is
  the trade the user chose.
- **Several inline draws in one send** (Auto-visualize on a round, feedback on two visuals,
  Finish redraws): publish everything else first, so the user can read the new round while
  you draw. That first patch carries the answers, replies, and next round, `agent.handled`,
  `"agent": { "status": "working" }` (not `waiting`), and every question's `drawing`. Then
  draw the questions one after another, patching each question's `version`, `note`,
  `variants`, and `"drawing": null` as its file is written, and set
  `"agent": { "status": "waiting" }` with the last one. Send stays disabled until then.
- A subagent draw of the same question already in flight still wins: never two draws of
  one question at once. Queue the request in that question's `visual.queued` as usual;
  when the in-flight draw lands, draw the queued bullets the way the newest queued request
  asked (inline when its `subagent` was `false`). Recover that flag from the request in
  `events.jsonl` if needed; `queued` holds only text bullets. For queued inline work, set
  `agent.status` to `working` and clear `queued` when marking `drawing`, then publish the
  completed version and return to `waiting`; leave `handled` unchanged because the queued
  sends were already acknowledged.

Feedback arrives as `visual-feedback` actions (see Handling a send); it is written in
Visualize, where the composer reads **Add feedback and redraw**, and explicitly requests a
redraw. Answers and question discussions (written in Questions, where the composer reads
**Add to discussion**) do not. On Finish the visuals are reconciled with the decisions and
copied next to the doc.

### Auto-visualize

The header's **Auto-visualize** switch is off by default. Clicking it sends
`{ "type": "auto-visualize", "on": true|false, "subagent": … }` at once; record it as
`"autoVisualize": { "on": …, "subagent": … }`. While it is on, every round you publish
(Handling a send, step 4) also requests a draw for each **new** question you judge
**visual**: one whose answer changes what the user would see on the page, or the shape of
the system a diagram would show. Skip questions with little to show (a timing rule, a
threshold, a naming choice); they stay one click away. Use the recorded `subagent` for
these draws, under the rules above: background subagents launched together with the round's
patch, or inline after the round is published, with Send held. Turning the switch on does
not draw questions already on the page, and turning it off cancels nothing in flight.

## Terminal input

Text the user types in the terminal during a grill answers the current question when that is
unambiguous (one open question, or the text names one): record it exactly as a page send would
(`answer.kind: "text"`, or `"option"` when it is a letter, and `status: "answered"`), then
continue as in "Handling a send" from step 3. Its step 6 patch leaves `agent.handled` as it is:
there was no send. Otherwise ask which question it answers, in one line. The doc path may
also be changed this way ("write the doc to …" → patch `"doc"`).

## Finish

On a `finish` action, or when the user says finish in the terminal:

1. Write the design doc to `doc` (relative to the project root). It is exhaustive and
   self-contained, in this order: a one-paragraph summary (naming the visuals folder,
   `docs/<slug>-visuals/`, when step 3 exports any); **Terms** (each with its Avoid list);
   **Why** (the problem in the user's words); **Locked decisions** (every `durable`
   question: the decision, a ratings table with options as rows and axes as columns, the
   decision in bold and every rating as a word (good / mixed / poor, a dash for `na` or an
   unrated axis; never invent ratings), then the rejected options and why each lost,
   applying the consistency rule and its escape from Interview method);
   **Routine choices** (every other answered question, one bullet each);
   **Verified facts** (anything you established by exploring rather than asking, if any);
   **Risks**; **Deferred**
   (deferred questions, with what would reopen them); **Open threads** (discussion points
   that ended without a decision). Every decision whose question has an exported visual
   links it, opened on the chosen variant: `[visual](<slug>-visuals/q3.html#B)` (a
   free-text answer opens on `#yours`). Importance levels stay out of the doc. Do not
   compress: a reader with no access to the session must be able to build from it.
2. Patch `"finished": { "doc": … }` and `"agent": { "status": "waiting" }`
   (after a page Finish this is the send's one patch, with `handled`); the page shows the
   finished banner and locks staging.
3. Export every question visual (a question whose `visual.version` is 1 or more) to
   `docs/<slug>-visuals/<qid>.html`, next to the doc (same folder, the doc's slug plus
   `-visuals`). Questions never visualized are not drawn at Finish. Each must be reconciled
   with every answered question before it is exported:
   - A draw in flight lands first (or fails, step 5 of Visualize); queue any further
     reconciliation under the same rules.
   - A visual that is not stale and that nothing contradicts is copied as it is.
   - A stale visual, when the `finish` action's `redraw` is `true` (the confirm's **Redraw
     them first** box, ticked by default; absent means `true`): request one reconciling
     draw of it, using the action's `subagent` under
     [Subagent or inline](#subagent-or-inline), and copy the file when it lands.
   - A stale visual, when `redraw` is `false`: copy it as it is, and in the copy insert one
     banner element right after the `<body>` tag, such as
     `<div style="position:sticky;top:0;z-index:99;padding:8px 14px;background:#fbe9e4;color:#9a3a26;font:14px system-ui">Out of date: drawn before Q5 and Q7 were decided.</div>`,
     naming the questions in its `staleBy`. Do not edit the session's own file.

   Then add `"visuals": "docs/<slug>-visuals/"` to `finished` (it is replaced whole, so
   give `doc` again). If everything can be exported without waiting for a draw (no draw in
   flight, and no redraw or only inline ones done before step 2), fold this into the step 2
   patch; otherwise return to listening and patch `finished` once the last export is done.
4. Once there is no draw in flight and the exports are complete, stop the persistent
   Monitor with TaskStop, or stop the server as described in Wait mode.
5. Print one line with the doc path (and the visuals folder). End.

## Wait mode (agents without a Monitor tool)

Start the server with `node $SKILL/server.mjs serve --session <session> --detach --open`
(macOS, Linux and Windows alike); `--open` follows Start step 3's rule, so drop it on resume
and with `--lan`. It puts the server in the background with its output in
`<session>/serve.log`, prints the ready line with the URL once the server is listening, and exits;
if a server for the session is already running it says so (`"already": true`) instead of
starting another. Never start `serve` as a harness background task or with a shell `&`: it
can hold your turn so `wait` never runs. Verify it with `url` as in Start. If the harness
terminates detached children, keep `serve` in a harness-managed running shell session that
lets you continue calling tools while it runs, and verify `url` again. A live page confirms
the server is running, **not** that the agent is listening. See [Use](README.md#use) for the
page's listener warning and `listenerOf` in `server.mjs` for its heartbeat grace period.
Keep the gap between waits short.

Keep this loop active in the current agent turn:

1. On entry and on resume run `node $SKILL/server.mjs pending --session <session>` and drain
   it exactly as Resume step 3 says: every printed line in one turn, in order, following
   "Handling a send", with one patch at the end whose `agent.handled` is the last seq — not
   a patch and a new question round per queued send.
2. Run `node $SKILL/server.mjs wait --session <session> --after <agent.handled>`.
   Use the last acknowledged `handled` from your patch, not the last sequence merely seen.
   `--timeout` (default 480) bounds how long that wait *process* sits idle before exiting 3;
   it prints the send and exits the moment one lands, so a long idle timeout never delays
   delivery. It is not how long one tool call should block: if the shell tool yields a
   running process or session ID, keep that single wait alive and poll it in bounded steps
   (60 seconds or less, within the harness's limits) so user input and draw completions are
   still handled promptly. Never start a second waiter for the same session. Pass a short
   `--timeout` only when the harness cannot keep a yielded process between calls and each
   wait must run to completion in the foreground.
3. Exit 0 returns a send: handle it and acknowledge it atomically, then loop with the new
   `handled`. Exit 3 is an idle timeout: re-issue the wait. Other failures need inspection;
   recover if possible, otherwise report the inactive listener rather than silently exit.
4. When a draw completes, publish its version and return to this loop. If a wait process
   is still active, resume it. Publishing a finished prototype is not finishing the grill.

The user does not need to type "continue" in the terminal to deliver a browser Send.
Only stop under the turn-boundary conditions above. On Finish, once the doc and every
exported visual are saved, stop the server using the verified `pid` in `<session>/server.json`.

## state.json

What each field means. You write it only through `patch`.

`axes`, `level`, `levelReason`, and option `ratings` are optional in stored state for
compatibility; `new` does not write them. Follow Interview method when authoring questions.
When supplied, `axes` must be a non-empty array with non-blank string keys and names and
unique keys. When absent from state, it uses the default axes defined in Interview method;
`axes: null` removes an explicit set. The validator rejects changes to axis keys, names, or order while
non-empty ratings exist both before and after the patch, even if the ratings are rewritten.
A supplied `levelReason` must be a string, and every supplied `level` requires a non-blank
reason. `ratings` must be an object using only the grill's axis keys and the values shown
below. For the Your-call rule, see Interview method; when changing a rated question to
`yours`, replace its `options` without ratings in the same patch.

```jsonc
{
  "topic": "…", "intent": "why this grill exists, 1-2 sentences", "doc": "docs/x-design.md", "project": "/abs/path", "created": "ISO",
  "agent": { "status": "waiting|working", "since": "ISO", "handled": 3 },
  "note": "optional short sentence shown above the question list",
  "finished": { "doc": "docs/x-design.md", "visuals": "docs/x-visuals/", "at": "ISO" },  // only after Finish
  "autoVisualize": { "on": true, "subagent": true },            // only after an auto-visualize action
  "terms": [{ "term": "…", "def": "…", "avoid": ["…"] }],
  "axes": [{ "key": "ux", "name": "User experience" }, …],     // optional; absent = ux, correct, risk, cost
  "questions": [{
    "id": "q7", "round": 4, "deps": ["q2"], "title": "…", "body": "…",
    "level": "skim|check|careful|yours", "levelReason": "high stakes, close call",  // levelReason required with level
    "options": [{ "k": "A", "text": "…", "ratings": { "ux": "good|mixed|poor|na", … } }],  // keys from axes; none on "yours"
    "multi": false,                                             // true: any number of options may be picked
    "rec": { "option": "A", "why": "…" },                       // or { "text": "…", "why": "…" }; multi: { "options": ["A","C"], "why": "…" }
    "status": "open|answered|deferred|reopened", "durable": false, "updated": false,
    "answer": { "kind": "accept|option|text", "option": "A", "text": "…" },  // multi: { "kind": "accept|option", "options": ["A","C"] }
    "explore": { "at": "ISO", "rows": [{ "option": "A", "pros": ["…"], "cons": ["…"] }] },  // after an explore action
    "thread": [{ "who": "user|agent", "text": "…", "at": "ISO", "on": "visual" }],  // "on": only on feedback about the visual and its reply
    "visual": {                                                 // only once this question is visualized; file: visuals/<id>.html
      "kind": "prototype|diagram", "version": 3, "at": "ISO",
      "note": "v3: filter pane moved to the left rail per Q3",
      "variants": ["A", "B", "C"],                              // what the file holds: option letters, "rec" (no options), "yours" (free text)
      "stale": false, "staleBy": ["q5"],                        // stale: a later decision shows on it; staleBy: which ones (appends)
      "drawing": { "since": "ISO", "seq": 12 },                 // while its draw runs; version is 0 before the first lands
      "queued": ["feedback: make the sidebar collapsible"]      // its draw requests that arrived during its draw; next draw takes them
    }
  }]
}
```

Send lines (`events.jsonl`, also printed by `serve`):

```jsonc
{ "type": "send", "seq": 12, "at": "ISO", "session": "/abs/session/folder", "actions": [
  { "q": "q15", "type": "answer", "kind": "accept|option|text", "option": "A", "text": "…" },
  { "q": "q16", "type": "answer", "kind": "accept|option", "options": ["A", "C"] },  // a multi question
  { "q": "q8",  "type": "thread", "text": "…" },
  { "q": "q17", "type": "defer" }, { "q": "q3", "type": "reopen" }, { "q": "q9", "type": "explore" },
  { "q": "q3", "type": "visualize", "subagent": true }, { "q": "q3", "type": "visual-feedback", "text": "…", "subagent": true },
  { "type": "auto-visualize", "on": true, "subagent": true },
  { "type": "finish", "subagent": true, "redraw": true } ] }
// subagent: the page's Use subagent checkbox; absent means true. finish carries subagent once a
// question has a visual, and redraw (the confirm's "Redraw them first" box) once one is stale.
```
