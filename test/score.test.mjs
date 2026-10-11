import { test, before } from "node:test";
import assert from "node:assert/strict";
import { relevance, healthScore, availabilityScore, ineligibleReason, isFull, isDormant } from "../src/recommend/score.mjs";
import { nearDuplicate, diversify } from "../src/recommend/diversify.mjs";
import { explain } from "../src/recommend/explain.mjs";
import { openDb } from "../src/db/index.mjs";
import { seed } from "../src/db/seed.mjs";
import { recommend } from "../src/recommend/index.mjs";

const circle = (o = {}) => ({
  id: 1, name: "Some Circle", description: null, cover_image_url: null, access: "public", join_policy: "open",
  max_members: 20, member_count: 10, feed_posts_30d: 5, chat_messages_30d: 30, days_since_activity: 2,
  avg_engagement: 5, topic_slug: "negotiation", topic_label: "Negotiation", tags: [], ...o,
});
const ctx = (stated = [], memberOf = []) => ({ stated, memberOf });
const NEG = { slug: "negotiation", label: "Negotiation" };

test("relevance: stated topic beats tag, tag beats nothing", () => {
  assert.equal(relevance(circle(), ctx([NEG])).kind, "stated");
  const viaTag = relevance(circle({ topic_slug: "confidence", tags: [NEG] }), ctx([NEG]));
  assert.equal(viaTag.kind, "tag");
  assert.ok(viaTag.score < relevance(circle(), ctx([NEG])).score);
  assert.equal(relevance(circle({ topic_slug: "confidence" }), ctx([NEG])).kind, "none");
});

test("relevance: topic-less Circle matches on name/description keywords", () => {
  const c = circle({ topic_slug: null, topic_label: null, name: "Salary Negotiation Collective" });
  assert.equal(relevance(c, ctx([NEG])).kind, "keyword");
  assert.equal(relevance(circle({ topic_slug: null, name: "Women of the 405" }), ctx([NEG])).kind, "none");
});

test("relevance: inferred from memberships only when nothing is stated", () => {
  const joined = [{ circle_id: 9, topic_slug: "negotiation", topic_label: "Negotiation" }];
  assert.equal(relevance(circle(), ctx([], joined)).kind, "inferred");
  const viaTag = relevance(circle({ topic_slug: "confidence", tags: [NEG] }), ctx([], joined));
  assert.equal(viaTag.kind, "inferred_tag");
  // stated interests suppress inference
  assert.equal(relevance(circle(), ctx([{ slug: "confidence", label: "Confidence" }], joined)).kind, "none");
  // memberships in topic-less Circles contribute nothing and don't crash
  assert.equal(relevance(circle(), ctx([], [{ circle_id: 9, topic_slug: null, topic_label: null }])).kind, "none");
});

test("eligibility: uncapped is never full; at-capacity is; over-capacity is", () => {
  assert.equal(isFull(circle({ max_members: null, member_count: 500 })), false);
  assert.equal(isFull(circle({ max_members: 15, member_count: 15 })), true);
  assert.equal(isFull(circle({ max_members: 15, member_count: 16 })), true);
});

test("eligibility: dormant needs BOTH no posts and long idle; quiet-but-alive is kept", () => {
  assert.equal(isDormant(circle({ feed_posts_30d: 0, days_since_activity: 200 })), true);
  assert.equal(isDormant(circle({ feed_posts_30d: 0, days_since_activity: 20 })), false);
  assert.equal(isDormant(circle({ feed_posts_30d: 3, days_since_activity: 200 })), false);
  assert.equal(isDormant(circle({ feed_posts_30d: 0, days_since_activity: 60 })), false, "boundary: exactly 60 days is kept");
});

test("eligibility: each reason is reported on its own", () => {
  const none = new Set();
  assert.equal(ineligibleReason(circle({ access: "unlisted" }), none), "unlisted");
  assert.equal(ineligibleReason(circle({ id: 5 }), new Set([5])), "already_member");
  assert.equal(ineligibleReason(circle({ max_members: 10, member_count: 10 }), none), "full");
  assert.equal(ineligibleReason(circle({ feed_posts_30d: 0, days_since_activity: 90 }), none), "dormant");
  assert.equal(ineligibleReason(circle(), none), null);
});

test("availability: near-full is penalised but non-zero; request-to-join below open", () => {
  const roomy = availabilityScore(circle({ max_members: 30, member_count: 10 }));
  const nearFull = availabilityScore(circle({ max_members: 12, member_count: 11 }));
  assert.ok(nearFull < roomy && nearFull > 0);
  assert.ok(availabilityScore(circle({ join_policy: "request" })) < availabilityScore(circle()));
  assert.equal(availabilityScore(circle({ max_members: null })), 1);
});

test("health: monotonic in activity and always within [0,1]", () => {
  const quiet = healthScore(circle({ feed_posts_30d: 0, chat_messages_30d: 0, avg_engagement: 0, days_since_activity: 100 })).score;
  const busy = healthScore(circle({ feed_posts_30d: 20, chat_messages_30d: 220, avg_engagement: 25, days_since_activity: 0 })).score;
  const huge = healthScore(circle({ feed_posts_30d: 5000, chat_messages_30d: 99999, avg_engagement: 999, days_since_activity: -3 })).score;
  assert.ok(quiet < busy);
  for (const s of [quiet, busy, huge]) assert.ok(s >= 0 && s <= 1.0001, `score ${s}`);
});

test("near-duplicates: same topic AND topic-named; same topic alone is not a duplicate", () => {
  const a = circle({ id: 10, name: "Negotiation Circle" });
  const b = circle({ id: 11, name: "The Negotiation Table" });
  const c = circle({ id: 12, name: "Women Who Lead", topic_slug: "negotiation" });
  const d = circle({ id: 13, name: "Negotiation Circle", topic_slug: "confidence", topic_label: "Confidence" });
  assert.equal(nearDuplicate(a, b), true);
  assert.equal(nearDuplicate(a, c), false);
  assert.equal(nearDuplicate(a, d), false);
  assert.equal(nearDuplicate(circle({ topic_slug: null, name: "x" }), circle({ topic_slug: null, name: "x" })), false);
});

test("diversify: respects limit, handles empty and short pools, tie-breaks by id", () => {
  assert.deepEqual(diversify([], 5), []);
  const mk = (id, topic) => ({ circle: circle({ id, topic_slug: topic, topic_label: topic, name: `n${id}` }), score: 0.5, rel: {} });
  const out = diversify([mk(3, "a"), mk(2, "b"), mk(1, "c")], 10);
  assert.deepEqual(out.map((x) => x.circle.id), [1, 2, 3]);
  assert.equal(diversify([mk(1, "a"), mk(2, "b"), mk(3, "c")], 2).length, 2);
});

test("explanations only state facts we hold", () => {
  const c = circle({ feed_posts_30d: 0, max_members: 12, member_count: 11, join_policy: "request" });
  const text = explain(c, { kind: "none", topic: null }, "interests").explanation;
  assert.ok(!/interest/.test(text), "no interest claim without a match");
  assert.ok(!/posts? this month/.test(text), "no activity claim with zero posts");
  assert.match(text, /Only 1 spot left, join by request/);
  assert.ok(!/lively/.test(text), "no 'lively' claim for a Circle with no posts");
    assert.match(explain(circle(), { kind: "inferred", topic: "Negotiation" }, "inferred").explanation, /already joined/);
  assert.match(explain(circle({ feed_posts_30d: 1 }), { kind: "stated", topic: "Negotiation" }, "interests").explanation, /1 post this month/);
});

let db;
before(() => { db = openDb(":memory:"); seed(db); });

test("seeding twice is idempotent", () => {
  const count = () => db.prepare("SELECT (SELECT COUNT(*) FROM memberships) m, (SELECT COUNT(*) FROM posts) p, (SELECT COUNT(*) FROM user_topics) t").get();
  const before = { ...count() };
  seed(db);
  assert.deepEqual({ ...count() }, before);
});

test("inferred strategy users get relevance from memberships, never claim stated interests", () => {
  let checked = 0;
  for (let uid = 1; uid <= 100; uid++) {
    const r = recommend(db, uid, { limit: 25 });
    if (r.strategy !== "inferred") continue;
    checked++;
    for (const x of r.recommendations) assert.ok(!/your interest/.test(x.explanation), `user ${uid}: ${x.explanation}`);
  }
  assert.ok(checked > 0, "dataset has inferred-strategy users");
});

test("output shape: debug omitted by default, limit clamped, ranks contiguous, scores descending-ish", () => {
  const r = recommend(db, 7, { limit: 999 });
  assert.ok(r.recommendations.length <= 25);
  assert.ok(r.recommendations.every((x, i) => x.rank === i + 1 && !("debug" in x)));
  assert.equal(recommend(db, 7, { limit: 0 }).recommendations.length, 1, "limit floors at 1");
  assert.equal(recommend(db, 7).recommendations.length, 10, "default is 10");
  assert.equal(recommend(db, 424242), null, "unknown user");
});

test("a member of one duplicate is not shown the sibling's duplicates as extra rows", () => {
  const uid = 15;
  const r = recommend(db, uid, { limit: 25 });
  const shown = r.recommendations.map((x) => x.circle.id);
  for (const x of r.recommendations) for (const s of x.similar_circle_ids) assert.ok(!shown.includes(s), `${s} both shown and collapsed`);
});
