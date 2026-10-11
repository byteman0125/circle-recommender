import { test, before } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.mjs";
import { seed } from "../src/db/seed.mjs";
import { recommend } from "../src/recommend/index.mjs";
import { ineligibleReason, healthScore, isFull, isDormant } from "../src/recommend/score.mjs";
import { buildServer } from "../src/server.mjs";

let db;
before(() => {
  db = openDb(":memory:");
  seed(db);
});

const ids = (r) => r.recommendations.map((x) => x.circle.id);

test("cold start (user 42): non-empty, healthy, topic-diverse, honest reasons", () => {
  const r = recommend(db, 42);
  assert.equal(r.strategy, "cold_start");
  assert.equal(r.recommendations.length, 10);
  const topics = r.recommendations.map((x) => x.circle.topic);
  assert.equal(new Set(topics).size, topics.length, "no repeated topics in a cold-start list");
  for (const x of r.recommendations) {
    assert.ok(!x.explanation.includes("your interest"), "must not claim an interest the member never stated");
  }
});

test("obvious matches (user 7): Circles 5 and 6 are in the top 3", () => {
  const top3 = ids(recommend(db, 7)).slice(0, 3);
  assert.ok(top3.includes(5) && top3.includes(6), `got ${top3}`);
});

test("duplicates (user 15): at most one of Circles 10/11/12, others linked as similar", () => {
  const r = recommend(db, 15);
  const dupes = ids(r).filter((id) => [10, 11, 12].includes(id));
  assert.equal(dupes.length, 1);
  const winner = r.recommendations.find((x) => x.circle.id === dupes[0]);
  assert.deepEqual([...winner.similar_circle_ids, winner.circle.id].sort(), [10, 11, 12]);
});

test("full/inactive (user 23): 20 and 21 absent, 22 in top 3", () => {
  const r = recommend(db, 23, { limit: 25 });
  assert.ok(!ids(r).includes(20) && !ids(r).includes(21));
  assert.ok(ids(r).slice(0, 3).includes(22));
});

test("full and dormant rules work independently of `access` (Circle 21 is also unlisted)", () => {
  const circles = Object.fromEntries(
    db.prepare("SELECT * FROM circles WHERE id IN (20, 21)").all().map((c) => [c.id, { ...c, access: "public", days_since_activity: 0, avg_engagement: 5 }]),
  );
  circles[21].days_since_activity = (Date.parse("2026-09-21") - Date.parse(circles[21].last_activity_at)) / 86400000;
  assert.ok(isFull(circles[20]));
  assert.equal(ineligibleReason(circles[20], new Set()), "full");
  assert.ok(isDormant(circles[21]));
  assert.equal(ineligibleReason(circles[21], new Set()), "dormant");
  // a healthy Circle outscores a dead one on activity
  assert.ok(healthScore({ ...circles[20], days_since_activity: 1 }).score > healthScore(circles[21]).score);
});

test("invariants hold for every user in the dataset", () => {
  const circles = new Map(db.prepare("SELECT * FROM circles").all().map((c) => [c.id, c]));
  for (let uid = 1; uid <= 100; uid++) {
    const r = recommend(db, uid, { limit: 25 });
    assert.ok(r.recommendations.length >= 1, `user ${uid} got nothing`);
    const joined = new Set(db.prepare("SELECT circle_id FROM memberships WHERE user_id = ?").all(uid).map((m) => m.circle_id));
    const seen = new Set();
    for (const x of r.recommendations) {
      const c = circles.get(x.circle.id);
      assert.ok(!seen.has(c.id), `user ${uid}: duplicate id ${c.id}`);
      seen.add(c.id);
      assert.ok(!joined.has(c.id), `user ${uid}: already a member of ${c.id}`);
      assert.equal(c.access, "public");
      assert.ok(c.max_members === null || c.member_count < c.max_members, `user ${uid}: full circle ${c.id}`);
      assert.ok(![21, 32].includes(c.id), `user ${uid}: dormant circle ${c.id}`);
      assert.ok(x.explanation.length > 0 && x.reasons.length >= 1);
    }
  }
});

test("deterministic: same input, same output", () => {
  assert.deepEqual(recommend(db, 7), recommend(db, 7));
});

test("HTTP API: success, debug, limit, 404 and 400", async () => {
  process.env.NODE_ENV = "test";
  const app = buildServer(db);
  const ok = await app.inject("/users/7/recommendations?limit=3&debug=true");
  assert.equal(ok.statusCode, 200);
  const body = ok.json();
  assert.equal(body.recommendations.length, 3);
  assert.ok(body.recommendations[0].debug.health_parts);
  assert.equal((await app.inject("/users/9999/recommendations")).statusCode, 404);
  assert.equal((await app.inject("/users/abc/recommendations")).statusCode, 400);
  assert.equal((await app.inject("/users/7/recommendations?limit=500")).statusCode, 400);
  await app.close();
});

test("server auto-seeds an empty database instead of 404-ing every user", async () => {
  process.env.NODE_ENV = "test";
  const app = buildServer(openDb(":memory:"));
  assert.equal((await app.inject("/users/7/recommendations")).statusCode, 200);
  await app.close();
});

test("demo UI: page, favicon and member list", async () => {
  process.env.NODE_ENV = "test";
  const app = buildServer(db);
  const page = await app.inject("/");
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.equal((await app.inject("/favicon.ico")).statusCode, 204);
  const users = (await app.inject("/users")).json();
  assert.equal(users.length, 100);
  assert.deepEqual(users.find((u) => u.id === 7).interests, ["Leadership skills", "Public speaking"]);
  await app.close();
});
