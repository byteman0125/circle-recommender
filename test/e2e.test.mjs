import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { openDb } from "../src/db/index.mjs";
import { seed } from "../src/db/seed.mjs";
import { recommend } from "../src/recommend/index.mjs";
import { buildServer } from "../src/server.mjs";

process.env.NODE_ENV = "test";
let db, app, base;

before(async () => {
  db = openDb(":memory:");
  seed(db);
  app = buildServer(db);
  await app.listen({ port: 0, host: "127.0.0.1" }); // real socket, real HTTP
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => app.close());

test("RECS_NOW moves the clock: same data, later 'now', lower recency and different scores", () => {
  const run = (now) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `
          import { openDb } from "./src/db/index.mjs"; import { seed } from "./src/db/seed.mjs";
          import { recommend } from "./src/recommend/index.mjs";
          const db = openDb(":memory:"); seed(db);
          const r = recommend(db, 7, { limit: 3, debug: true });
          console.log(JSON.stringify(r.recommendations.map(x => ({ id: x.circle.id, s: x.score, rec: x.debug.health_parts.recency }))));`],
        { cwd: fileURLToPath(new URL("..", import.meta.url)), env: { ...process.env, RECS_NOW: now }, encoding: "utf8" },
      ),
    );
  const snapshot = run("2026-09-21T00:00:00Z");
  const later = run("2027-03-21T00:00:00Z");
  assert.ok(snapshot[0].rec > 0.5, "recently active Circle has high recency at the snapshot date");
  assert.ok(later[0].rec < 0.01, "six months later the same Circle has decayed");
  assert.notDeepEqual(snapshot.map((x) => x.s), later.map((x) => x.s));
});

test("keyword matching works end to end for a topic-less Circle (never fires on the shipped data)", () => {
  const d = openDb(":memory:");
  seed(d);
  d.prepare(
    `INSERT INTO circles (id, name, slug, description, topic_id, cover_image_url, format, access, join_policy, max_members,
       member_count, created_at, last_activity_at, feed_posts_30d, chat_messages_30d)
     VALUES (900, 'Salary Negotiation Collective', 'salary-neg', 'Practice asks together', NULL, NULL, 'virtual', 'public', 'open',
       NULL, 10, '2026-01-01T00:00:00.000Z', '2026-09-20T00:00:00.000Z', 12, 80)`,
  ).run();
  const hit = recommend(d, 15, { limit: 25, debug: true }).recommendations.find((x) => x.circle.id === 900);
  assert.ok(hit, "topic-less Circle is recommended");
  assert.equal(hit.debug.relevance_kind, "keyword");
  assert.match(hit.explanation, /Looks relevant to your interest in Negotiation/);
  const other = recommend(d, 23, { limit: 25, debug: true }).recommendations.find((x) => x.circle.id === 900);
  assert.notEqual(other?.debug.relevance_kind, "keyword", "does not match users with unrelated interests");
});

test("real HTTP: every user returns 200 with a well-formed body", async () => {
  for (let id = 1; id <= 100; id++) {
    const res = await fetch(`${base}/users/${id}/recommendations`);
    assert.equal(res.status, 200, `user ${id}`);
    assert.match(res.headers.get("content-type"), /application\/json/);
    const body = await res.json();
    assert.equal(body.user_id, id);
    assert.ok(["interests", "inferred", "cold_start"].includes(body.strategy));
    for (const r of body.recommendations) {
      assert.equal(typeof r.circle.name, "string");
      assert.equal(typeof r.explanation, "string");
      assert.ok(Array.isArray(r.similar_circle_ids));
      assert.ok(r.score >= 0 && r.score <= 1);
    }
  }
});

test("real HTTP: concurrent requests are consistent with sequential ones", async () => {
  const ids = Array.from({ length: 100 }, (_, i) => (i % 100) + 1);
  const bodies = await Promise.all(ids.map((id) => fetch(`${base}/users/${id}/recommendations`).then((r) => r.json())));
  bodies.forEach((b, i) => assert.deepEqual(b, recommend(db, ids[i])));
});

test("performance sanity: 100 recommendations in well under 5s; one request is fast", () => {
  const t0 = performance.now();
  for (let id = 1; id <= 100; id++) recommend(db, id, { limit: 25 });
  const total = performance.now() - t0;
  assert.ok(total < 5000, `100 users took ${Math.round(total)}ms`);
  const t1 = performance.now();
  recommend(db, 7);
  assert.ok(performance.now() - t1 < 250, "single request under 250ms");
});

test("real HTTP: error shapes and edge inputs", async () => {
  const get = (p) => fetch(base + p);
  assert.equal((await get("/health")).status, 200);
  const nf = await get("/users/9999/recommendations");
  assert.equal(nf.status, 404);
  assert.equal((await nf.json()).error, "user_not_found");
  assert.equal((await get("/users/1/recommendations?limit=-1")).status, 400);
  assert.equal((await get("/users/1.5/recommendations")).status, 400);
  assert.equal((await get("/nope")).status, 404);
  assert.equal((await (await get("/users/1/recommendations?limit=25")).json()).recommendations.length <= 25, true);
});

// ---- demo page: run its real script in jsdom against the real server --------
async function mountPage() {
  const html = readFileSync(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8");
  const dom = new JSDOM(html, { runScripts: "dangerously", url: base + "/", pretendToBeVisual: true,
    beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, base), o); } });
  const w = dom.window;
  const until = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error("page never rendered"); };
  await until(() => w.document.querySelectorAll("#out li").length > 0);
  return { w, until };
}

test("demo page: renders members, scenario labels and a ranked list", async () => {
  const { w } = await mountPage();
  const opts = [...w.document.querySelectorAll("#user option")];
  assert.equal(opts.length, 100);
  assert.match(opts.find((o) => o.value === "42").textContent, /cold start/);
  assert.equal(w.document.querySelectorAll("#out li").length, 10);
  assert.match(w.document.querySelector("#out li .why").textContent, /\S/);
  w.close();
});

test("demo page: switching member updates summary, strategy note and results; scores toggle works", async () => {
  const { w, until } = await mountPage();
  const sel = w.document.querySelector("#user");
  sel.value = "42";
  sel.dispatchEvent(new w.Event("change"));
  await until(() => /No interests and no Circles/.test(w.document.querySelector("#strategy").textContent));
  assert.match(w.document.querySelector("#who").textContent, /none selected/);

  sel.value = "15";
  sel.dispatchEvent(new w.Event("change"));
  await until(() => /Negotiation/.test(w.document.querySelector("#who").textContent));
  await until(() => w.document.querySelectorAll("#out li").length > 0);
  assert.match(w.document.querySelector("#out").textContent, /Similar Circles you could also look at/);
  assert.equal(w.document.querySelectorAll("#out details").length, 0);

  const box = w.document.querySelector("#debug");
  box.checked = true;
  box.dispatchEvent(new w.Event("change"));
  await until(() => w.document.querySelectorAll("#out details").length > 0);
  w.close();
});

test("demo page: escapes HTML from the API instead of injecting it", async () => {
  const d = openDb(":memory:");
  seed(d);
  d.prepare("UPDATE circles SET name = '<img src=x onerror=window.__pwned=1>' WHERE id = 22").run();
  const evil = buildServer(d);
  await evil.listen({ port: 0, host: "127.0.0.1" });
  const b = `http://127.0.0.1:${evil.server.address().port}`;
  const html = readFileSync(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8");
  const dom = new JSDOM(html, { runScripts: "dangerously", url: b + "/", pretendToBeVisual: true,
    beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, b), o); } });
  const w = dom.window;
  const sel = () => w.document.querySelector("#user");
  for (let i = 0; i < 100 && !sel()?.options.length; i++) await new Promise((r) => setTimeout(r, 20));
  sel().value = "23";
  sel().dispatchEvent(new w.Event("change"));
  for (let i = 0; i < 100 && !/img src/.test(w.document.querySelector("#out").textContent); i++) await new Promise((r) => setTimeout(r, 20));
  assert.match(w.document.querySelector("#out").textContent, /<img src=x/, "shown as text");
  assert.equal(w.document.querySelector("#out img"), null, "no element created");
  assert.equal(w.__pwned, undefined);
  w.close();
  await evil.close();
});
