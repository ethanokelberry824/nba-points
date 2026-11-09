/**
 * Drives the real site (API + front end both running), checks every page, and saves
 * screenshots to web/screenshots/.
 *
 *   uvicorn api.main:app            (project root, port 8000)
 *   npm run dev                     (web/, port 3000)
 *   npm run screenshots             (web/)
 *
 * For every page, at desktop (1440) and phone (390), in dark and light:
 *   - everything loaded (no skeletons left, no error cards, no console errors)
 *   - no sideways scrolling on a phone
 *   - axe accessibility scan (contrast, labels, ARIA): no serious or critical problems
 * Version 2 cases (desktop): Luka with Austin Reaves switched off, Luka vs SAS with Victor
 * Wembanyama switched off (opponent section expanded), and an opponent with a "Key defender"
 * line switched off (the line gets highlighted).
 * Plus behavior checks: star / bench / teammate switched off, Cmd+K search, 3 quick
 * switch flips = 1 request, Copy link reopens the same matchup, clicking a bar on
 * vs Every Team opens that matchup, the table view, sidebar links keep the player,
 * the 404 page, and the "waking up" message when the API is slow.
 */

import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const OUT = new URL("../screenshots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
// clear old screenshots (share-image.png is made separately, keep it)
for (const f of readdirSync(OUT)) if (f.endsWith(".png") && f !== "share-image.png") unlinkSync(OUT + f);

const players = await (await fetch(`${API}/players`)).json();
const regulars = players.filter((p) => p.games >= 3);
const star = regulars.slice().sort((a, b) => b.ppg - a.ppg)[0];
const benchPool = regulars.filter((p) => p.mpg >= 15 && p.mpg < 22).sort((a, b) => a.ppg - b.ppg);
const bench = benchPool[Math.floor(benchPool.length / 4)];
console.log(`star: ${star.name} (${star.team}, ${star.ppg} ppg)  bench: ${bench.name} (${bench.team}, ${bench.ppg} ppg)`);

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const browser = await chromium.launch();
const errors = [];
let failed = 0;
const fail = (msg) => {
  failed += 1;
  console.log(`  FAIL: ${msg}`);
};

async function newPage({ viewport = DESKTOP, theme = "dark", scale = 1, name = "page", hasTouch = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: theme, hasTouch });
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  return { ctx, page };
}

const settled = async (page, ready) => {
  await page.getByText(ready, { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-slot="skeleton"]').length === 0, null, { timeout: 30_000 });
  await page.waitForTimeout(1200); // CountUp, charts and the fade-in settle
};

async function pageChecks(page, label, { minBars = 0 } = {}) {
  const problems = [];
  for (const t of ["Couldn't get a prediction", "Can't reach the model", "Couldn't load"])
    if (await page.getByText(t).count()) problems.push(`error card "${t}"`);
  const bars = await page.locator(".recharts-bar-rectangle").count();
  if (bars < minBars) problems.push(`only ${bars} chart bars (want ${minBars}+)`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`page scrolls sideways by ${overflow}px`);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const bad = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  for (const v of bad)
    for (const n of v.nodes.slice(0, 8))
      problems.push(`a11y ${v.id}: ${n.target.join(" ").slice(0, 70)} | ${(n.failureSummary?.split("\n")[1] ?? "").trim().slice(0, 150)}`);
  console.log(`  [${label}] ${problems.length ? "PROBLEMS:\n      " + problems.join("\n      ") : "ok"}`);
  failed += problems.length;
}

async function snap(page, file) {
  await page.evaluate(() => window.scrollTo(0, 0)); // sticky bar + phone pill belong at the top
  await page.mouse.move(250, 380); // park the mouse over the hero (spotlight)
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${file}.png`, fullPage: true });
}

const hero = (page) => page.getByText("Predicted points", { exact: true });
const heroText = async (page) => (await hero(page).locator("xpath=..").innerText()).match(/\d+\.\d/)?.[0];

// ---------------------------------------------------------------- all 4 pages x 2 sizes x 2 themes

const PAGES = [
  { slug: "matchup", url: `/?player=${star.id}`, ready: "Predicted points", minBars: 8 },
  { slug: "vs-every-team", url: `/vs-every-team?player=${star.id}`, ready: "Best to toughest matchup", minBars: 29 },
  { slug: "model-performance", url: "/model-performance", ready: "Every model on the test season", minBars: 20 },
  { slug: "how-it-works", url: "/how-it-works", ready: "Tried and dropped (didn't beat the simpler version):", minBars: 0 },
];

for (const p of PAGES) {
  for (const [device, viewport, scale] of [["desktop", DESKTOP, 1], ["phone", PHONE, 2]]) {
    for (const theme of ["dark", "light"]) {
      const name = `${p.slug}-${device}-${theme}`;
      const { ctx, page } = await newPage({ viewport, theme, scale, name });
      await page.goto(`${WEB}${p.url}`);
      await settled(page, p.ready);
      await pageChecks(page, name, { minBars: p.minBars });
      await snap(page, name);
      await ctx.close();
    }
  }
}

// ---------------------------------------------------------------- Matchup cases

const CHIP = /^[+-]?\d+\.\d with .+ out$/;
const switchOffTeammate = async (page) => {
  const sw = page.locator('[role="switch"]').first();
  const who = (await sw.getAttribute("aria-label"))?.replace(" playing", "");
  await sw.click();
  await page.getByText(CHIP).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  const chip = await page.getByText(CHIP).first().innerText();
  if (!(await page.getByText("Everyone playing").count())) fail("everyone-playing line missing");
  console.log(`  [teammate off] switched off ${who}: "${chip}"`);
};

for (const [device, viewport, scale] of [["desktop", DESKTOP, 1], ["phone", PHONE, 2]]) {
  {
    const { ctx, page } = await newPage({ viewport, scale, name: `bench-${device}` });
    await page.goto(`${WEB}/?player=${bench.id}`);
    await settled(page, "Predicted points");
    await pageChecks(page, `matchup bench ${device}`, { minBars: 8 });
    await snap(page, `matchup-bench-${device}-dark`);
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage({ viewport, scale, name: `teammate-${device}` });
    await page.goto(`${WEB}/?player=${star.id}`);
    await settled(page, "Predicted points");
    await switchOffTeammate(page);
    await snap(page, `matchup-teammate-out-${device}-dark`);
    await ctx.close();
  }
}

// ---------------------------------------------------------------- version 2 cases (desktop)

const byName = (n) => players.find((p) => p.name.startsWith(n));
const luka = byName("Luka Don");
const reaves = byName("Austin Reaves");
const wemby = byName("Victor Wemb");
const allTeams = (await (await fetch(`${API}/teams`)).json()).teams;
const SHOTS = /^\d+ min, \d+ shots/;

const switchOff = async (page, name) => {
  const sw = page.getByRole("switch", { name: `${name} playing` });
  await sw.click();
  await page.getByText(CHIP).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  return page.getByText(CHIP).first().innerText();
};
const openOpponent = async (page) => {
  const btn = page.getByRole("button", { name: /Opponent players out \(small effect\)/ });
  if ((await btn.getAttribute("aria-expanded")) !== "false") fail("opponent section should start collapsed");
  await btn.click();
  if (!(await page.getByText("Opponent absences barely move this model.", { exact: false }).count()))
    fail("opponent note missing after expanding");
};

if (luka && reaves) {
  const { ctx, page } = await newPage({ name: "v2-reaves" });
  await page.goto(`${WEB}/?player=${luka.id}`);
  await settled(page, "Predicted points");
  if (!(await page.getByText(SHOTS).count())) fail('who\'s out rows should read "36 min, 18 shots"');
  const chip = await switchOff(page, reaves.name);
  await pageChecks(page, "v2 reaves out", { minBars: 8 });
  console.log(`  [v2 reaves] Luka with Reaves off: "${chip}"`);
  await snap(page, "v2-matchup-reaves-out-desktop-dark");
  await ctx.close();
} else fail("Luka or Reaves not in /players");

const sas = allTeams.find((t) => t.abbr === "SAS");
if (luka && wemby && sas) {
  const { ctx, page } = await newPage({ name: "v2-wemby" });
  await page.goto(`${WEB}/?player=${luka.id}&opp=${sas.id}`);
  await settled(page, "Predicted points");
  await openOpponent(page);
  const chip = await switchOff(page, wemby.name);
  const keyLine = page.getByText(/points per 100 possessions without Wembanyama/);
  const keyText = (await keyLine.count()) ? await keyLine.first().innerText() : null;
  const highlighted = await page.getByText("Out tonight", { exact: true }).count();
  await pageChecks(page, "v2 wemby out", { minBars: 8 });
  console.log(`  [v2 wemby] Luka vs SAS with Wembanyama off: "${chip}" | key defender: ${keyText} | highlighted: ${highlighted > 0}`);
  if (!keyText || !highlighted) fail("Wembanyama 'Defense without him' line missing or not highlighted");
  if ((await page.getByText("Defense without him", { exact: true }).count()) !== 1) fail("want exactly one 'Defense without him' line");
  await snap(page, "v2-matchup-wemby-out-vs-sas-desktop-dark");
  await ctx.close();
} else fail("Luka, Wembanyama or SAS not found");

// an opponent that has a "Key defender" line right now (same rule as opponent-card.tsx)
if (luka) {
  const meta = await (await fetch(`${API}/meta`)).json();
  let found = null;
  for (const t of allTeams.filter((t) => t.abbr !== luka.team)) {
    const rot = await (await fetch(`${API}/rotations?player_id=${luka.id}&opp_id=${t.id}&date=${meta.default_date}`)).json();
    const opp = rot.teams.find((x) => x.side === "opponent");
    const p = opp.players
      .filter((p) => p.still_on_team && p.key_defender)
      .sort((a, b) => b.def_delta_shrunk - a.def_delta_shrunk)[0];
    if (p) {
      found = { team: t, p };
      break;
    }
  }
  if (found) {
    const { ctx, page } = await newPage({ name: "v2-key-defender" });
    await page.goto(`${WEB}/?player=${luka.id}&opp=${found.team.id}`);
    await settled(page, "Predicted points");
    const line = await page.getByText(/points per 100 possessions without/).first().innerText();
    await openOpponent(page);
    await switchOff(page, found.p.name);
    const highlighted = await page.getByText("Out tonight", { exact: true }).count();
    await pageChecks(page, "v2 key defender", { minBars: 8 });
    console.log(`  [v2 key defender] ${found.team.abbr}: "${line}" | switched off -> highlighted: ${highlighted > 0}`);
    if (!highlighted) fail("key defender line not highlighted when he's switched off");
    await snap(page, `v2-matchup-key-defender-${found.team.abbr}-desktop-dark`);
    await ctx.close();
  } else console.log("  [v2 key defender] no opponent has a key defender line right now");
}

// Model Performance: the accuracy ladder fills on scroll and the pro marker's note opens on hover / tap
for (const [device, viewport, scale] of [["desktop", DESKTOP, 1], ["phone", PHONE, 2]]) {
  const { ctx, page } = await newPage({ viewport, scale, name: `ladder-${device}`, hasTouch: device === "phone" });
  await page.goto(`${WEB}/model-performance`);
  await settled(page, "Every model on the test season");
  const ladder = page.getByText("Within about a tenth of a point of a pro projection site.", { exact: true });
  await ladder.scrollIntoViewIfNeeded();
  await page.getByText(/We closed \d+% of the gap to the floor\./).waitFor();
  const pro = page.getByRole("button", { name: /Pro projection site \(Statz\.ai\)/ });
  if (device === "desktop") await pro.hover();
  else await pro.tap();
  const note = page.getByText("Statz.ai grades every projection publicly", { exact: false });
  await note.waitFor({ timeout: 5000 });
  const link = await page.getByRole("link", { name: "Source" }).getAttribute("href");
  await page.waitForTimeout(1600); // fill animation
  const card = page.locator('[data-slot="card"]').filter({ has: ladder });
  // the open note can hang below the card, so capture a bit past its bottom edge
  const box = await card.boundingBox();
  await page.screenshot({ path: `${OUT}ladder-${device}-dark.png`, fullPage: true,
    clip: { x: box.x, y: box.y + (await page.evaluate(() => window.scrollY)), width: box.width, height: box.height + 140 } });
  console.log(`  [ladder ${device}] filled, pro note open, source ${link}`);
  if (link !== "https://statz.ai/nba/projections/accuracy") fail("ladder source link");
  await ctx.close();
}

// Copy link: the copied URL reopens the same matchup (same side, players out, number)
{
  const { ctx, page } = await newPage({ name: "copy-link" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: WEB });
  await page.goto(`${WEB}/?player=${star.id}`);
  await settled(page, "Predicted points");
  await page.getByRole("radio", { name: "Away" }).click();
  await page.waitForTimeout(1500);
  await switchOffTeammate(page);
  const before = await heroText(page);
  await page.getByRole("button", { name: "Copy link" }).click();
  await page.getByRole("button", { name: "Copied" }).waitFor();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const q = new URL(link).searchParams;
  const missing = ["player", "opp", "home", "date", "out"].filter((k) => !q.get(k));
  if (missing.length) fail(`copied link is missing ${missing.join(", ")}: ${link}`);
  const { ctx: ctx2, page: p2 } = await newPage({ name: "copy-link-open" });
  await p2.goto(link);
  await settled(p2, "Predicted points");
  const after = await heroText(p2);
  const offs = await p2.locator('[role="switch"][aria-checked="false"]').count();
  const away = await p2.getByRole("radio", { name: "Away" }).getAttribute("aria-checked");
  console.log(`  [copy link] ${link.replace(WEB, "")} -> reopened: ${after} (was ${before}), ${offs} switched off, away=${away}`);
  if (after !== before || offs !== 1 || away !== "true") fail("copied link didn't reopen the same matchup");
  await ctx.close();
  await ctx2.close();
}

// Cmd+K search: open, type, pick
{
  const { ctx, page } = await newPage({ name: "search" });
  await page.goto(`${WEB}/?player=${star.id}`);
  await settled(page, "Predicted points");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search players or teams...").fill("reaves");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}search-desktop-dark.png` });
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Austin Reaves" }).waitFor({ timeout: 30_000 });
  console.log("  [search] Cmd+K, typed, Enter -> Austin Reaves loaded");
  await ctx.close();
}

// 3 quick switch flips with the keyboard (focus + Space) -> 1 /predict request with all 3 out
{
  const { ctx, page } = await newPage({ name: "debounce" });
  await page.goto(`${WEB}/?player=${star.id}`);
  await settled(page, "Predicted points");
  let posts = 0;
  page.on("request", (r) => r.url().endsWith("/predict") && r.method() === "POST" && posts++);
  const sws = page.locator('[role="switch"]');
  for (const i of [0, 1, 2]) {
    await sws.nth(i).focus();
    await page.keyboard.press("Space");
  }
  await page.getByText(CHIP).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const chip = await page.getByText(CHIP).first().innerText();
  console.log(`  [keyboard switches] 3 quick flips -> ${posts} /predict request(s): "${chip}"`);
  if (posts !== 1 || (chip.match(/ and /g) ?? []).length !== 1) fail("debounce / keyboard switches");
  await ctx.close();
}

// ---------------------------------------------------------------- vs Every Team behavior

{
  const { ctx, page } = await newPage({ name: "sweep" });
  await page.goto(`${WEB}/vs-every-team?player=${bench.id}&home=0`);
  await settled(page, "Best to toughest matchup");
  // the sidebar keeps the player and side when going to Matchup
  const href = await page.getByRole("link", { name: "Matchup", exact: true }).first().getAttribute("href");
  if (!href?.includes(`player=${bench.id}`) || !href.includes("home=0")) fail(`sidebar Matchup link lost the selection: ${href}`);
  // table view
  await page.getByRole("radio", { name: "Table view" }).click();
  const rows = await page.locator("tbody tr").count();
  if (rows !== 29) fail(`table has ${rows} rows`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}vs-every-team-table-desktop-dark.png`, fullPage: true });
  // back to the chart, click the 2nd bar -> Matchup with that opponent
  await page.getByRole("radio", { name: "Chart view" }).click();
  await page.waitForTimeout(800);
  const meta = await (await fetch(`${API}/meta`)).json();
  const sw = await (await fetch(`${API}/sweep?player_id=${bench.id}&date=${meta.default_date}&home=false`)).json();
  const second = sw.opponents[1].abbr;
  await page.locator(".recharts-bar-rectangle").nth(1).click();
  await page.waitForURL(/\/\?/);
  await settled(page, "Predicted points");
  const badge = (await hero(page).locator("xpath=../..").innerText()).split("\n")[0];
  console.log(`  [vs every team] sidebar link ${href}, table ${rows} rows, clicked bar #2 (${second}) -> Matchup "${badge}"`);
  if (!badge.includes(`@ ${second}`)) fail(`bar click opened the wrong matchup (wanted ${second})`);
  await ctx.close();
}

// ---------------------------------------------------------------- 404, cold start

{
  const { ctx, page } = await newPage({ name: "404", viewport: PHONE, scale: 2 });
  const r = await page.goto(`${WEB}/no-such-page`);
  await page.getByText("That page airballed").waitFor();
  await page.waitForTimeout(500);
  console.log(`  [404] status ${r?.status()}`);
  if (r?.status() !== 404) fail("404 status");
  await page.screenshot({ path: `${OUT}not-found-phone-dark.png` });
  await ctx.close();
  // the browser logs the 404 response itself as a console error; that one is expected
  for (let i = errors.length - 1; i >= 0; i--) if (errors[i].startsWith("404:")) errors.splice(i, 1);
}

{
  const { ctx, page } = await newPage({ viewport: PHONE, scale: 2, name: "cold" });
  await ctx.route(`${API}/**`, async (route) => {
    await new Promise((r) => setTimeout(r, 4500));
    await route.continue();
  });
  await page.goto(`${WEB}/?player=${star.id}`);
  await page.getByText("Waking up the model").waitFor({ timeout: 10_000 });
  const skeletons = await page.locator('[data-slot="skeleton"]').count();
  await page.screenshot({ path: `${OUT}cold-start-phone-dark.png` });
  console.log(`  [cold start] waking-up message shown with ${skeletons} skeleton placeholders`);
  if (!skeletons) fail("no skeletons during cold start");
  await ctx.close();
}

await browser.close();
if (errors.length) console.log("CONSOLE ERRORS:\n  " + [...new Set(errors)].join("\n  "));
console.log(failed || errors.length ? "FAIL" : "PASS");
process.exit(failed || errors.length ? 1 : 0);
