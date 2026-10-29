# Visual brief

You are drawing a **question visual** for a grill-with-ui design interview: one HTML file
for one question, showing the design as it stands with that question's options drawn as
**variants** the user switches between. Use the session folder, question id, kind (prototype
or diagram), variants, default variant, project root, and change list from the interview
context or the interviewer's brief. Drawing mode is defined in
[Subagent or inline](SKILL.md#subagent-or-inline). This file holds the artifact rules;
follow every one.

## What you read

- `<session>/state.json`: `topic`, `terms` (use these words in labels), `questions`. Each
  question has `status`, `options`, `rec` (the recommendation), `answer` when answered,
  `thread`, and sometimes `explore`. Find **your question** by its id: its `options` are
  your variants, and the messages in its `thread` tagged `"on": "visual"` are the user's
  feedback on earlier versions, newest last. **Every other question** is context: it
  decides the rest of the page you draw around your question's region.
- `<session>/visuals/<qid>.html` when it exists (a redraw): edit it. Keep layout, names,
  and everything the change list does not mention stable, so the user can see what moved.
- The project root when the visual should match real UI or code (a prototype of a page that
  exists, a diagram of modules that exist): look first, then draw what is there plus the
  design. The interview context or brief says whether the topic is a change to an existing
  app and where it lands (a route, page, or component).

## Source of truth

The questions are the source of truth; the visual is derived from them.

- Draw the **whole page (or system) as decided so far**, not your question's element alone,
  so the user judges each option where it will sit.
- **Answered** questions: draw the decision, plain.
- **Open, reopened, or deferred** questions other than yours: draw the recommended option
  and mark that region **assumed · Qn open** (dashed outline, or a small tag in the corner),
  so the visual reads as a map of what is settled and what is not.
- **Your question** is the one part that changes between variants. Outline its region in
  every variant (a 2px solid outline in an accent colour, with a small label such as
  **Q3 · option B**) so the eye finds what changes when the user switches.
- Never draw something the questions contradict, even if feedback asks for it. The
  interviewer handles that by reopening the question; you draw what the change list says.

## Variants

One variant per key the brief lists, all in the same file, drawn from one shared baseline:
everything outside your question's region is identical in every variant, so switching shows
only the difference the option makes.

- An **option letter** (`A`, `B`, …): the page with that option chosen. On a question whose
  options can be combined (`multi`), a letter means the page with that option included,
  alongside the recommended set.
- `rec`: a question without options; the page with the recommendation (`rec.text`).
- `yours`: the user's free-text answer, drawn as you understand it.

The default variant is the one the brief names (the answer, else the recommendation). The
page drives the file, which must obey this protocol exactly:

```html
<script>
  const VARIANTS = ["A", "B", "C"], DEFAULT_VARIANT = "B";
  function show(v) {
    if (!VARIANTS.includes(v)) v = DEFAULT_VARIANT;
    document.documentElement.dataset.variant = v; // CSS (or your own code) shows that variant
    // ...and anything else a variant switch needs; update the standalone bar below if present
  }
  addEventListener("message", (e) => { if (e.data && typeof e.data.variant === "string") show(e.data.variant); });
  addEventListener("hashchange", () => show(decodeURIComponent(location.hash.slice(1))));
  show(decodeURIComponent(location.hash.slice(1)));
</script>
```

- The grill page sends `postMessage({ variant: "B" })` to switch, and loads the file with
  `#B` in its URL. Both must work, and an unknown or empty variant falls back to the
  default.
- Switching never reloads, never resets state the user clicked into (an open menu, a
  selected row), and never scrolls the page to the top.
- When the file is opened on its own (`window.top === window`), as an exported copy is, show
  a small fixed variant bar (one button per variant, the current one marked) in a corner so
  the copy stays switchable. Inside the grill page (`window.top !== window`) hide it: the
  page has its own switcher.

## The file

`<session>/visuals/<qid>.html` (create the `visuals` folder if it is missing), **one
self-contained file**: inline CSS and JS, system fonts, no network requests, no external
assets except the Mermaid option below. These are artifact requirements; see
[Server commands](README.md#server-commands) for the sandbox's security guarantees. Before
you finish, run `grep -n '://' <session>/visuals/<qid>.html`; the only allowed hit is the
Mermaid script tag described below.

Start the file with an HTML comment: the topic, the question id and its variants, the other
questions it reflects (id and one phrase each), which regions are assumed, and for a redraw
what this version changed.

**Prototype** (kind = prototype): a working page, not a picture of one. Real layout, real
controls; the clicks, toggles, and states the design has; plausible fake data for the topic.

- **A change to an existing app** (an improvement or a new feature): the prototype shows
  what the user will actually see in the app, in place. Reproduce the real page it lands on,
  with the app's own chrome around it (navigation, header, sidebar, footer, neighbouring
  content), and the app's own look: read its stylesheets, design tokens, and the components
  the page uses; copy the colours, type scale, spacing, radii, borders, and control styles
  rather than approximating them. Existing parts are drawn as they are today; the new or
  changed parts are drawn as designed, so the two can be judged together. A screenshot-like
  fidelity is the goal: someone who uses the app should not be able to tell from the frame
  that it is a prototype. If the app loads a web font, use its nearest system fallback and
  say so in the header comment so the prototype stays usable offline.
- **A new UI** with nothing to match: the fidelity of a good wireframe. Neutral palette,
  clear hierarchy, no decoration the design did not decide.

**Diagram** (kind = diagram): inline SVG, or HTML boxes with an SVG arrow layer, with a
legend; architecture, data flow, sequence, or state, whichever fits the question. Label the
edges. The variants redraw only the part your question changes (a box, an edge, a step),
outlined as above. Past roughly fifteen nodes hand layout stops working; then you may embed
Mermaid from a CDN inside the file, with a one-line note in the file that it needs network.

## Reply

Do not paste the file back. For a subagent draw, reply with ONE line: what the visual now
shows, or for a redraw what changed, naming question ids ("Q3 v2: the filter pane as a left
rail, top bar, or flyout on the sales page; Q5 assumed"). The interviewer copies it into the
version note. For an inline draw, use that line as the version note and complete the send
under [Subagent or inline](SKILL.md#subagent-or-inline).
