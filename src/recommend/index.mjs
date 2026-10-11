// recommend(db, userId, opts) -> ranked Circles with explanations.
import { loadUserContext, loadCircles } from "./candidates.mjs";
import { ineligibleReason, healthScore, availabilityScore, qualityScore, relevance, totalScore } from "./score.mjs";
import { diversify } from "./diversify.mjs";
import { explain } from "./explain.mjs";
import { LIMITS } from "./config.mjs";

const r3 = (x) => Math.round(x * 1000) / 1000;

export function recommend(db, userId, { limit = LIMITS.default, debug = false } = {}) {
  const ctx = loadUserContext(db, userId);
  if (!ctx) return null;
  limit = Math.min(Math.max(1, limit), LIMITS.max);

  const strategy = ctx.stated.length ? "interests" : ctx.memberOf.length ? "inferred" : "cold_start";
  const memberIds = new Set(ctx.memberOf.map((m) => m.circle_id));

  const scored = [];
  for (const c of loadCircles(db)) {
    if (ineligibleReason(c, memberIds)) continue;
    const rel = relevance(c, ctx);
    const health = healthScore(c);
    const availability = availabilityScore(c);
    const quality = qualityScore(c);
    scored.push({
      circle: c,
      rel,
      score: totalScore(rel.score, health.score, availability, quality),
      breakdown: {
        relevance: rel.score,
        relevance_kind: rel.kind,
        health: health.score,
        health_parts: health.parts,
        availability,
        quality,
      },
    });
  }

  const picked = diversify(scored, limit, { coldStart: strategy === "cold_start" });
  return {
    user_id: userId,
    strategy,
    recommendations: picked.map((p, i) => {
      const c = p.circle;
      const { reasons, explanation } = explain(c, p.rel, strategy);
      const out = {
        rank: i + 1,
        circle: {
          id: c.id,
          name: c.name,
          description: c.description,
          topic: c.topic_slug,
          format: c.format,
          join_policy: c.join_policy,
          member_count: c.member_count,
          max_members: c.max_members,
          cover_image_url: c.cover_image_url,
        },
        score: r3(p.score),
        reasons,
        explanation,
        similar_circle_ids: p.similar_circle_ids,
      };
      if (debug) out.debug = { ...p.breakdown, adjusted_score: r3(p.adjusted) };
      return out;
    }),
  };
}
