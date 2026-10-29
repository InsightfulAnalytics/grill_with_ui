// Focused real-server contract test. Agent patches below model the documented draw
// lifecycle; this does not invoke an LLM or test a model's instruction-following.
// PLAYWRIGHT_PKG=/path/to/@playwright/test/index.mjs node test/subagent-toggle.e2e.mjs
// Optional GRILL_EVIDENCE_DIR saves screenshots and the actual persisted sends.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_PKG || "@playwright/test");
const server = join(dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");
const scratch = mkdtempSync(join(tmpdir(), "grill-toggle-"));
const env = { ...process.env, GRILL_HOME: join(scratch, "home") };
const evidence = process.env.GRILL_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const cli = (args, input) => execFileSync(process.execPath, [server, ...args], { env, cwd: scratch, encoding: "utf8", input });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let child, port;
async function stop() {
  if (child && child.exitCode === null) await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
}
try {
  // Reuse the same browser and origin for two grills: the unchecked preference
  // from the first must not leak into the second.
  for (const subagent of [false, true]) {
    const { session } = JSON.parse(cli(["new", "--topic", `Draw preference: ${subagent ? "background" : "inline"}`]));
    const patch = (value) => cli(["patch", "--session", session], JSON.stringify(value));
    patch({ agent: { status: "waiting", handled: 0 }, questions: [{ id: "q1", round: 1, title: "Choose the drawing mode", body: "Test the visualization preference.", rec: { text: "Use the default", why: "Keep interview context small." }, status: "open" }] });
    child = spawn(process.execPath, [server, "serve", "--session", session, ...(port ? ["--port", String(port)] : [])], { env, stdio: ["ignore", "pipe", "inherit"] });
    const ready = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("Server did not become ready")), 5000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const line = output.split("\n").find((s) => s.includes('"type":"ready"'));
        if (line) { clearTimeout(timeout); resolve(JSON.parse(line)); }
      });
    });
    port = new URL(ready.url).port;
    await page.goto(ready.url);
    await page.locator("#use-subagent").waitFor();
    assert.equal(await page.locator("#use-subagent").isChecked(), true, "each grill defaults to subagents, including on a reused origin");
    await page.locator("#use-subagent").setChecked(subagent);
    await page.reload();
    await page.locator("#use-subagent").waitFor();
    assert.equal(await page.locator("#use-subagent").isChecked(), subagent, "preference survives reload");
    const sends = () => readFileSync(join(session, "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    const send = async (selector, actions) => {
      const response = page.waitForResponse((r) => r.url().endsWith("/send") && r.request().method() === "POST");
      await page.locator(selector).click();
      assert.equal((await response).status(), 200);
      const event = sends().at(-1);
      assert.deepEqual(event.actions, actions);
      return event.seq;
    };
    let version = 0;
    const draw = async (seq) => {
      // Inline draws keep the Send unacknowledged until the file is ready.
      patch({ agent: { status: subagent ? "waiting" : "working", ...(subagent ? { handled: seq } : {}) }, questions: [{ id: "q1", visual: { kind: "prototype", version, stale: false, drawing: { seq } } }] });
      await page.waitForFunction(() => document.querySelector("#visual-empty")?.textContent.includes("Drawing the first version") || document.querySelector("#visual-strip")?.textContent.includes("regenerating"));
      if (!subagent) {
        await page.waitForFunction(() => document.querySelector("#agent-status")?.textContent.includes("working"));
        assert.equal(await page.locator("#send").isDisabled(), true);
        const state = JSON.parse(readFileSync(join(session, "state.json"), "utf8"));
        assert.equal(state.agent.handled, seq - 1, "inline send is not acknowledged before drawing completes");
        if (evidence && version === 0) await page.screenshot({ path: join(evidence, "inline-drawing.png"), fullPage: true });
      }
      version++;
      if (!existsSync(join(session, "visuals"))) mkdirSync(join(session, "visuals"));
      writeFileSync(join(session, "visuals", "q1.html"), `<!doctype html><title>Draw lifecycle fixture</title><h1>Visual version ${version}</h1><p>Fixture for ${subagent ? "background" : "inline"} draw delivery.</p>`);
      patch({ questions: [{ id: "q1", visual: { version, drawing: null, note: `Version ${version} delivered` } }], agent: { handled: seq, status: "waiting" } });
      // q1 has no options, so its one variant is the recommendation.
      await page.waitForFunction((v) => document.querySelector("#visual-frame")?.getAttribute("src") === `/visual?q=q1&v=${v}#rec` && !document.querySelector("#staged-list .sent"), version);
      assert.equal(await page.frameLocator("#visual-frame").locator("h1").textContent(), `Visual version ${version}`);
    };
    // Switching to Visualize on a question with no visual asks for its first draw.
    await draw(await send("#mode-visualize", [{ q: "q1", type: "visualize", subagent }]));
    await draw(await send("#regen", [{ q: "q1", type: "visualize", subagent }]));
    // Read the flag at Send time, not when individual feedback messages are staged.
    await page.locator("#aside-toggle").click(); // the discussion panel, where feedback is written, starts collapsed
    await page.locator("#use-subagent").setChecked(!subagent);
    for (const text of ["Use a narrower list", "Keep the title visible"]) {
      await page.locator("#feedback-in").fill(text);
      await page.locator("#stage-feedback").click();
    }
    await page.locator("#use-subagent").setChecked(subagent);
    await draw(await send("#send", ["Use a narrower list", "Keep the title visible"].map((text) => ({ q: "q1", type: "visual-feedback", text, subagent }))));
    // The agent marks the visual out of date, so the Finish confirm offers to redraw it first.
    patch({ questions: [{ id: "q1", visual: { stale: true, staleBy: ["q1"] } }] });
    await page.locator("#visual-stale").waitFor();
    await page.locator("#finish").click();
    assert.equal(await page.locator("#finish-redraw").isChecked(), true, "Redraw them first is ticked by default");
    const seq = await send("#finish-yes", [{ type: "finish", subagent, redraw: true }]);
    await draw(seq);
    patch({ finished: { doc: "docs/design.md", visuals: "docs/design-visuals/" } });
    await page.locator("#banner.done").waitFor();
    assert.equal(await page.locator("#use-subagent").isHidden(), true);
    if (evidence) writeFileSync(join(evidence, `toggle-${subagent}-events.jsonl`), readFileSync(join(session, "events.jsonl")));
    await page.goto("about:blank");
    await stop();
  }
  assert.deepEqual(errors, []);
  console.log("subagent toggle e2e: passed (both flags on every draw action, multiple feedback notes, Send-time choice, reload, per-grill isolation, inline drawing/acknowledgement, finished control)");
} finally {
  await browser.close();
  await stop();
  rmSync(scratch, { recursive: true, force: true });
}
