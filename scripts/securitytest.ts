// Security regressions for the design previews and the TTS disk cache.
// Windows uses installed Edge; other platforms use Playwright Chromium.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const project = process.cwd();

async function testPreviews() {
  const runtime = path.join(project, "design", "screens", "support.js");
  const source = fs.readFileSync(runtime, "utf8");
  assert.doesNotMatch(source, /\b(?:eval|Function|fetch)\s*\(|\bdocument\.(?:write|writeln)\s*\(|\.innerHTML\s*=/);
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined),
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    // The preview renderer needs no network. Even fonts can be blocked.
    await page.route("**/*", route => route.request().url().startsWith("file:") ? route.continue() : route.abort());
    for (const file of fs.readdirSync(path.dirname(runtime)).filter(name => name.endsWith(".dc.html"))) {
      await page.goto(pathToFileURL(path.join(path.dirname(runtime), file)).href);
      await page.locator("#dc-root").waitFor({ state: "attached" });
      assert.equal(await page.locator("x-dc").count(), 0, `${file} booted`);
      if (file !== "KBC Moments.dc.html") assert.ok((await page.locator("#dc-root").innerText()).length > 100);
      assert.doesNotMatch(await page.locator("#dc-root").innerText(), /\{\{/);
      console.log(`ok: ${file} renders`);
    }
    await page.goto(pathToFileURL(path.join(path.dirname(runtime), "05 Budgets.dc.html")).href);
    await page.getByRole("button", { name: "Moment shown", exact: false }).click();
    await page.waitForFunction(() => document.querySelector("#dc-root")?.textContent?.includes("52%"));
    await page.getByRole("button", { name: "Accepted", exact: false }).click();
    await page.waitForFunction(() => document.querySelector("#dc-root")?.textContent?.includes("78%"));
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#dc-root")?.textContent?.includes("64%"));

    await page.goto(pathToFileURL(path.join(path.dirname(runtime), "06 Dashboard.dc.html")).href);
    await page.getByRole("button", { name: "Marc · 71 · retired", exact: true }).click();
    assert.match(await page.locator("#dc-root").innerText(), /€34,210/);
    await page.locator('input[type="range"]').fill("0");
    assert.match(await page.locator("#dc-root").innerText(), /Nothing needs you today/);
    await page.getByRole("button", { name: /^sep$/i }).click();
    assert.equal(await page.locator('input[type="range"]').inputValue(), "5");
    await page.getByRole("button", { name: "Split comparison", exact: true }).click();
    assert.match(await page.locator("#dc-root").innerText(), /Same trigger, two customers/i);

    // Strings that the old runtime evaluated, linked, or imported are inert.
    await page.setContent(`<x-dc>
      <helmet><link rel="stylesheet" href="http://127.0.0.1/private"></helmet>
      <button onclick="window.compromised = true">Unsafe handler</button>
      <a href="javascript:window.compromised=true">Unsafe URL</a>
      <div>{{ constructor.constructor }}</div>
      <x-import from="http://169.254.169.254/latest/meta-data/" component="Attack"></x-import>
    </x-dc>
    <script type="text/x-dc" data-dc-script>window.compromised = true; class Component extends DCLogic {}</script>`);
    const requests: string[] = [];
    page.on("request", request => requests.push(request.url()));
    await page.addScriptTag({ path: runtime });
    await page.getByRole("button", { name: "Unsafe handler" }).click();
    assert.equal(await page.evaluate(() => Object.hasOwn(window, "compromised")), false);
    assert.equal(await page.locator("#dc-root a").getAttribute("href"), null);
    assert.equal(await page.locator("#dc-root script, #dc-root x-import").count(), 0);
    assert.equal(await page.locator("#dc-root button").getAttribute("onclick"), null);
    assert.deepEqual(requests, [], "injected imports and stylesheets make no requests");
    assert.deepEqual(errors, []);
    console.log("ok: all previews render, interactions work, and injected code/URLs stay inert");
  } finally {
    await browser.close();
  }
}

async function testVoiceCache() {
  const tempParent = fs.realpathSync(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(tempParent, "moments-security-"));
  const previousFetch = globalThis.fetch;
  const envKeys = ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL"] as const;
  const previousEnv = envKeys.map(key => process.env[key]);
  try {
    process.chdir(temp);
    process.env.ELEVENLABS_API_KEY = "test-only";
    delete process.env.ELEVENLABS_VOICE_ID;
    delete process.env.ELEVENLABS_MODEL;
    let requests = 0;
    globalThis.fetch = async (input, init) => {
      requests++;
      assert.equal(new URL(String(input)).origin, "https://api.elevenlabs.io");
      assert.equal(init?.method, "POST");
      return new Response("generated-audio", { headers: { "Content-Type": "audio/mpeg" } });
    };
    // Import after changing cwd so all disk activity is isolated in the temp tree.
    const { synthesize } = await import("../lib/voice");
    const text = "../../outside.mp3";
    assert.equal((await synthesize(text))?.toString(), "generated-audio");
    assert.equal((await synthesize(text))?.toString(), "generated-audio");
    assert.equal(requests, 1, "a regular cache entry is reused");
    const audioDir = path.join(temp, ".data", "audio");
    const files = fs.readdirSync(audioDir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^[a-f0-9]{32}\.mp3$/, "text cannot become a path");

    // A directory junction works on Windows without symlink privileges.
    const outside = path.join(temp, "outside");
    fs.mkdirSync(outside);
    fs.unlinkSync(path.join(audioDir, files[0]));
    fs.rmdirSync(audioDir);
    fs.symlinkSync(outside, audioDir, process.platform === "win32" ? "junction" : "dir");
    const hash = createHash("sha256").update(`JBFqnCBsd6RMkjVDRZzb|eleven_multilingual_v2|${text}`).digest("hex").slice(0, 32);
    const outsideFile = path.join(outside, `${hash}.mp3`);
    fs.writeFileSync(outsideFile, "private-outside-file");
    assert.equal((await synthesize(text))?.toString(), "generated-audio", "linked cache directories are not read");
    assert.equal(fs.readFileSync(outsideFile, "utf8"), "private-outside-file", "linked files are not overwritten");
    assert.equal(requests, 2);
    delete process.env.ELEVENLABS_API_KEY;
    assert.equal(await synthesize(text), null);
    assert.equal(requests, 2, "disabled voice makes no requests");
    console.log("ok: hashed cache paths, cache hits, linked-directory rejection, and disabled voice");
  } finally {
    process.chdir(project);
    globalThis.fetch = previousFetch;
    envKeys.forEach((key, index) => {
      if (previousEnv[index] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[index];
    });
    // Only remove the exact, newly created temporary test tree.
    assert.equal(path.dirname(path.resolve(temp)), tempParent);
    assert.ok(path.basename(temp).startsWith("moments-security-"));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function main() {
  await testPreviews();
  await testVoiceCache();
  console.log("All security regressions passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
