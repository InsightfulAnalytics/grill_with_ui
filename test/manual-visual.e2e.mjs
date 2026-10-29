// Question visuals end to end: answering a round never redraws a visual; the option switcher
// drives the sandboxed iframe (postMessage, and the URL fragment on load) without reloading it;
// Choose stages the previewed option; Visualize QN and Regenerate each ask for one draw of one
// question; and a visual stays sandboxed in the iframe and in a tab of its own.
// PLAYWRIGHT_PKG=/path/to/@playwright/test/index.mjs node test/manual-visual.e2e.mjs
// Optional GRILL_EVIDENCE_DIR saves sandbox screenshots and the actual persisted sends.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_PKG || "@playwright/test");
const evidence = process.env.GRILL_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const server = join(dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");
const env = { ...process.env, GRILL_HOME: mkdtempSync(join(tmpdir(), "grill-manual-visual-")) };
const { session } = JSON.parse(execFileSync(process.execPath, [server, "new", "--topic", "Manual visuals"], { env, encoding: "utf8" }));
const stateFile = join(session, "state.json");
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const question = (id, round, extra = {}) => ({ id, round, deps: [], title: `Question ${round}`, body: "Choose a direction.", options: [{ k: "A", text: "First" }, { k: "B", text: "Second" }], rec: { option: "A", why: "A fits." }, status: "open", thread: [], ...extra });
state.questions = [question("q1", 1, { visual: { kind: "prototype", version: 1, at: new Date().toISOString(), note: "Initial visual" } })];
state.agent = { status: "waiting", since: new Date().toISOString(), handled: 0 };
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
save();
// A visual that obeys the variant protocol in visual-brief.md: it shows the variant named by a
// postMessage, or by the URL fragment when it loads.
const visual = (label) => `<!doctype html><title>Visual fixture</title><p id='content'>${label}</p><p id='variant'></p>
<script>
const VARIANTS = ["A", "B"], DEFAULT_VARIANT = "A";
function show(v) { if (!VARIANTS.includes(v)) v = DEFAULT_VARIANT; document.getElementById("variant").textContent = v; }
addEventListener("message", (e) => { if (e.data && typeof e.data.variant === "string") show(e.data.variant); });
addEventListener("hashchange", () => show(decodeURIComponent(location.hash.slice(1))));
show(decodeURIComponent(location.hash.slice(1)));
</script>`;
mkdirSync(join(session, "visuals"));
writeFileSync(join(session, "visuals", "q1.html"), visual("Version one"));
const sends = () => readFileSync(join(session, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const child = spawn(process.execPath, [server, "serve", "--session", session], { env, stdio: ["ignore", "pipe", "inherit"] });
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Server did not become ready")), 5000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const line = output.split("\n").find((s) => s.includes('"type":"ready"'));
      if (line) { clearTimeout(timeout); resolve(JSON.parse(line).url); }
    });
  });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator(".opt.rec").waitFor();
  const frame = page.frameLocator("#visual-frame");
  const src = () => page.locator("#visual-frame").getAttribute("src");

  // Visualize on a question that has a visual shows it, opened on the recommendation, and asks for nothing.
  await page.locator("#mode-visualize").click();
  await frame.locator("#variant").filter({ hasText: "A" }).waitFor();
  assert.equal(await src(), "/visual?q=q1&v=1#A", "the file is loaded once, on the recommended variant");
  assert.equal(await page.locator("main").isHidden(), true, "the visual takes the card's place");
  assert.equal(await page.locator("nav .item").count(), 1, "the question list stays");
  assert.equal(readFileSync(join(session, "events.jsonl"), "utf8"), "", "viewing an existing visual requests no draw");
  await frame.locator("#content").evaluate((el) => { el.dataset.retained = "yes"; });

  // The switcher previews B by postMessage: no reload, nothing staged.
  await page.locator('.var[data-var="B"]').click();
  await frame.locator("#variant").filter({ hasText: "B" }).waitFor();
  assert.equal(await frame.locator("#content").getAttribute("data-retained"), "yes", "switching variants never reloads the iframe");
  assert.equal(await src(), "/visual?q=q1&v=1#A");
  assert.equal(await page.locator("#send").isDisabled(), true, "previewing stages nothing");
  // Choose stages the previewed option exactly as clicking its card would.
  await page.locator("#choose").click();
  assert.equal(await page.locator("#choose").textContent(), "B staged");
  assert.equal(await page.locator('.var.staged[data-var="B"]').count(), 1);
  assert.match(await page.locator("#staged-list").textContent(), /Q1 → B/);
  await page.locator("#mode-questions").click();
  assert.equal(await page.locator('.opt.staged[data-opt="B"]').count(), 1, "the card shows the option chosen in Visualize");
  await page.locator("#send").click();
  await page.locator(".mark.pending .spin").waitFor();
  assert.deepEqual(sends()[0].actions, [{ q: "q1", type: "answer", kind: "option", option: "B" }]);

  // The agent publishes the answer, the next question, the acknowledgement, and an out-of-date
  // mark together. There is intentionally no new HTML file or visual version.
  state.questions[0].status = "answered";
  state.questions[0].answer = { kind: "option", option: "B" };
  state.questions[0].visual.stale = true;
  state.questions[0].visual.staleBy = ["q2"];
  state.questions.push(question("q2", 2));
  state.agent.handled = 1;
  state.agent.since = new Date().toISOString();
  save();
  await page.waitForFunction(() => document.querySelector(".item.selected .id")?.textContent === "Q2");
  assert.equal(await page.locator(".mark.pending, .pending-line, #staged-list .sent").count(), 0, "the completed send clears without a visual redraw");
  assert.equal(await page.locator(".item .mark.answered svg").count(), 1);
  assert.equal(await page.locator('.item[data-q="q1"] .vis.stale').count(), 1, "the list marks the out-of-date visual");
  await page.locator(".opt.rec").click();
  assert.equal(await page.locator("#send").isEnabled(), true, "the new round can be answered immediately");
  await page.locator('.item[data-q="q1"]').click();
  await page.locator("#mode-visualize").click();
  await frame.locator("#variant").filter({ hasText: "B" }).waitFor();
  assert.equal(await src(), "/visual?q=q1&v=1#B", "the same version, opened on the recorded answer by the URL fragment");
  assert.match(await page.locator("#visual-stale").textContent(), /out of date since Q2/i, "an older visual is visibly marked out of date");
  assert.equal(await page.locator("#choose").textContent(), "B is your answer");
  assert.equal(sends().length, 1, "ordinary updates and viewing the visual do not request regeneration");

  // A question without a visual offers Visualize QN; picking it there asks for nothing.
  await page.locator('.item[data-q="q2"]').click();
  assert.equal(await page.locator("#visualize-q").textContent(), "Visualize Q2");
  assert.equal(await page.locator("#visual-frame").isHidden(), true);
  assert.equal(sends().length, 1, "picking a question in Visualize does not draw it");
  await page.locator("#visualize-q").click();
  await page.waitForFunction(() => document.getElementById("visual-empty")?.textContent.includes("Drawing the first version of Q2"));
  assert.deepEqual(sends()[1].actions, [{ q: "q2", type: "visualize", subagent: true }], "Visualize QN requests one draw of that question");
  state.questions[1].visual = { kind: "diagram", version: 0, stale: false, drawing: { since: new Date().toISOString(), seq: 2 } };
  state.agent.handled = 2;
  save();
  await page.waitForFunction(() => !document.getElementById("staged-list").textContent.includes("Sent #2"));
  assert.match(await page.locator("#visual-empty").textContent(), /Drawing the first version of Q2/, "the first draw runs in the background");
  assert.equal(await page.locator('.item[data-q="q2"] .vis .spin').count(), 1, "the list shows the draw in flight");
  writeFileSync(join(session, "visuals", "q2.html"), visual("Q2 version one"));
  state.questions[1].visual = { kind: "diagram", version: 1, at: new Date().toISOString(), note: "v1: first cut", stale: false };
  save();
  await page.waitForFunction(() => document.querySelector("#visual-frame")?.getAttribute("src") === "/visual?q=q2&v=1#A");
  assert.equal(await frame.locator("#content").textContent(), "Q2 version one", "the first version loads by itself, on the staged answer");

  // Staleness and the acknowledged sends remain correct across reloads; Regenerate redraws one question.
  await page.reload();
  await page.locator('.item[data-q="q1"]').click();
  await page.locator("#visual-stale").waitFor();
  assert.equal(await page.locator(".mark.pending, #staged-list .sent").count(), 0);
  await page.locator("#regen").click();
  await page.waitForFunction(() => document.querySelector("#visual-strip")?.textContent.includes("regenerating"));
  assert.deepEqual(sends()[2].actions, [{ q: "q1", type: "visualize", subagent: true }], "only the explicit Regenerate click requests a draw");
  assert.equal(sends().length, 3);

  writeFileSync(join(session, "visuals", "q1.html"), visual("Version two"));
  state.questions[0].visual = { kind: "prototype", version: 2, at: new Date().toISOString(), note: "v2", stale: false };
  state.agent.handled = 3;
  save();
  await page.waitForFunction(() => document.querySelector("#visual-frame")?.getAttribute("src") === "/visual?q=q1&v=2#B");
  assert.equal(await page.locator("#visual-stale").count(), 0, "a successful requested draw clears the stale indication");
  assert.equal(await frame.locator("#content").textContent(), "Version two");

  // The visual's scripts run, but never with the grill's origin: not in the iframe, and not
  // when the visual is opened directly in a tab (the server sends a sandbox CSP with it).
  writeFileSync(join(session, "visuals", "q1.html"), `<!doctype html><title>Visual sandbox check</title><h1 id='content'>Visual sandbox check</h1><p>Script execution: <span id='ran'></span></p><p>Session read (/state): <span id='read'></span></p><p>Send to agent (/send): <span id='sent'></span></p>
<script>
const put = (id, v) => { document.getElementById(id).textContent = v; };
put("ran", "scripts run");
fetch("/state").then((r) => r.text()).then((t) => (t.includes("Manual visuals") ? "read" : "empty"), () => "blocked").then((v) => put("read", v));
fetch("/send", { method: "POST", body: JSON.stringify({ actions: [{ q: "q1", type: "visualize" }] }) }).then((r) => "status " + r.status, () => "blocked").then((v) => put("sent", v));
</script>`);
  state.questions[0].visual.version = 3;
  save();
  await page.waitForFunction(() => document.querySelector("#visual-frame")?.getAttribute("src") === "/visual?q=q1&v=3#B");
  await frame.locator("#sent").filter({ hasText: /./ }).waitFor();
  await frame.locator("#read").filter({ hasText: /./ }).waitFor();
  assert.equal(await frame.locator("#ran").textContent(), "scripts run", "the visual's scripts still run in the iframe");
  assert.equal(await frame.locator("#read").textContent(), "blocked", "the iframed visual cannot read /state");
  assert.notEqual(await frame.locator("#sent").textContent(), "status 200", "the iframed visual cannot send to the agent");
  if (evidence) await page.screenshot({ path: join(evidence, "sandbox-iframe.png"), fullPage: true });
  const tab = await browser.newPage();
  tab.on("pageerror", (error) => errors.push(error.message));
  await tab.goto(url + "visual?q=q1&v=3");
  await tab.locator("#sent").filter({ hasText: /./ }).waitFor();
  await tab.locator("#read").filter({ hasText: /./ }).waitFor();
  assert.equal(await tab.locator("#ran").textContent(), "scripts run", "the visual's scripts run when opened directly");
  assert.equal(await tab.locator("#read").textContent(), "blocked", "the visual opened directly cannot read /state");
  assert.notEqual(await tab.locator("#sent").textContent(), "status 200", "the visual opened directly cannot send to the agent");
  if (evidence) {
    await tab.screenshot({ path: join(evidence, "sandbox-direct-tab.png"), fullPage: true });
    writeFileSync(join(evidence, "sandbox-events.jsonl"), readFileSync(join(session, "events.jsonl")));
    const results = async (surface) => ({
      scripts: await surface.locator("#ran").textContent(),
      stateRead: await surface.locator("#read").textContent(),
      send: await surface.locator("#sent").textContent(),
    });
    writeFileSync(join(evidence, "sandbox-results.json"), JSON.stringify({
      iframe: await results(frame), directTab: await results(tab),
      eventsBeforeVisual: 3, eventsAfterVisual: sends().length,
    }, null, 2));
  }
  await tab.close();
  assert.equal(sends().length, 3, "neither copy of the visual landed a send");

  assert.deepEqual(errors, []);
  console.log("manual visual e2e: passed (variant switcher by postMessage and fragment, Choose, acknowledgement without redraw, out-of-date marks, Visualize QN, explicit regeneration, reload, sandboxed visual)");
} finally {
  await browser?.close();
  if (child.exitCode === null) await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
}
