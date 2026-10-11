// Greedy re-ranking so a list isn't N copies of the same Circle.
//  - Near-duplicates (same topic AND both names are built around that topic, e.g. the three
//    "Negotiat*" Circles) are collapsed: only the best is listed, the rest are attached as similar_circle_ids.
//  - Other same-topic Circles are legitimately different (different community), so they are
//    only down-weighted, not removed.
import { DIVERSITY } from "./config.mjs";

const stems = (label) =>
  (label || "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).map((w) => w.slice(0, 5));

const nameMentionsTopic = (c) => {
  const nameWords = c.name.toLowerCase().split(/[^a-z]+/);
  return stems(c.topic_label).some((s) => nameWords.some((w) => w.startsWith(s)));
};

export const nearDuplicate = (a, b) =>
  Boolean(a.topic_slug) && a.topic_slug === b.topic_slug && nameMentionsTopic(a) && nameMentionsTopic(b);

export function diversify(scored, limit, { coldStart = false } = {}) {
  const penalty = coldStart ? DIVERSITY.coldStartSameTopicPenalty : DIVERSITY.sameTopicPenalty;
  const pool = scored.map((s) => ({ ...s }));
  const picked = [];
  while (picked.length < limit && pool.length) {
    for (const cand of pool) {
      let m = 1;
      for (const p of picked) if (cand.circle.topic_slug && cand.circle.topic_slug === p.circle.topic_slug) m *= penalty;
      cand.adjusted = cand.score * m;
    }
    pool.sort((a, b) => b.adjusted - a.adjusted || a.circle.id - b.circle.id);
    const best = pool.shift();
    best.similar_circle_ids = [];
    for (let i = pool.length - 1; i >= 0; i--) {
      if (nearDuplicate(best.circle, pool[i].circle)) best.similar_circle_ids.unshift(pool.splice(i, 1)[0].circle.id);
    }
    picked.push(best);
  }
  return picked;
}
