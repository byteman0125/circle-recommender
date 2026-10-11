// Pure scoring functions: Circle + member context -> signal scores in [0,1].
import { RELEVANCE, HEALTH, DORMANT, NEAR_FULL_SPOTS, PEER_SIZE, WEIGHTS } from "./config.mjs";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const logNorm = (x, cap) => clamp01(Math.log1p(x) / Math.log1p(cap));
const tokens = (s) => (s || "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);

export const isFull = (c) => c.max_members !== null && c.member_count >= c.max_members;
export const spotsLeft = (c) => (c.max_members === null ? null : c.max_members - c.member_count);
export const isDormant = (c) => c.feed_posts_30d === 0 && c.days_since_activity > DORMANT.maxDaysSinceActivity;

/** Why a Circle can't be shown at all (null = eligible). Each rule is independent of the others. */
export function ineligibleReason(c, memberCircleIds) {
  if (c.access !== "public") return "unlisted";
  if (memberCircleIds.has(c.id)) return "already_member";
  if (isFull(c)) return "full";
  if (isDormant(c)) return "dormant";
  return null;
}

export function healthScore(c) {
  const p = HEALTH.parts;
  const parts = {
    posts: logNorm(c.feed_posts_30d, HEALTH.postsCap),
    chat: logNorm(c.chat_messages_30d, HEALTH.chatCap),
    recency: Math.pow(0.5, Math.max(0, c.days_since_activity) / HEALTH.recencyHalfLifeDays),
    engagement: clamp01(c.avg_engagement / HEALTH.engagementCap),
  };
  const score = p.posts * parts.posts + p.chat * parts.chat + p.recency * parts.recency + p.engagement * parts.engagement;
  return { score, parts };
}

export function availabilityScore(c) {
  const join = c.join_policy === "open" ? 1 : 0.6;
  const spots = spotsLeft(c);
  const room = spots === null ? 1 : spots <= NEAR_FULL_SPOTS ? 0.3 : 1;
  return 0.5 * join + 0.5 * room;
}

export function qualityScore(c) {
  const n = c.member_count;
  const size = n >= PEER_SIZE.min && n <= PEER_SIZE.max ? 1 : n < 4 ? 0.3 : 0.7;
  const profile = (c.description ? 0.5 : 0) + (c.cover_image_url ? 0.5 : 0);
  return 0.7 * size + 0.3 * profile;
}

/**
 * Relevance of a Circle to the member. Returns { score, kind, topic } where kind says which signal won
 * ("stated" | "tag" | "keyword" | "inferred" | "inferred_tag" | "none") so explanations stay truthful.
 */
export function relevance(c, ctx) {
  const best = { score: 0, kind: "none", topic: null };
  const take = (score, kind, topic) => {
    if (score > best.score) Object.assign(best, { score, kind, topic });
  };
  const stated = new Map(ctx.stated.map((t) => [t.slug, t.label]));
  const tagSlugs = new Set(c.tags.map((t) => t.slug));

  if (c.topic_slug && stated.has(c.topic_slug)) take(RELEVANCE.statedTopic, "stated", stated.get(c.topic_slug));
  for (const [slug, label] of stated) if (tagSlugs.has(slug)) take(RELEVANCE.statedTag, "tag", label);

  if (!c.topic_slug) {
    // topic-less Circle: fall back to a text match on the member's stated interests
    const words = tokens(`${c.name} ${c.description ?? ""}`);
    for (const t of ctx.stated) {
      const hit = tokens(t.label)
        .filter((w) => w.length > 4)
        .some((w) => words.some((x) => x.startsWith(w.slice(0, 5))));
      if (hit) take(RELEVANCE.keyword, "keyword", t.label);
    }
  }

  if (ctx.stated.length === 0) {
    // inferred from existing memberships, only when nothing was stated
    for (const m of ctx.memberOf) {
      if (!m.topic_slug) continue;
      if (c.topic_slug === m.topic_slug) take(RELEVANCE.inferredTopic, "inferred", m.topic_label);
      else if (tagSlugs.has(m.topic_slug)) take(RELEVANCE.inferredTag, "inferred_tag", m.topic_label);
    }
  }
  return best;
}

export function totalScore(rel, health, availability, quality) {
  return WEIGHTS.relevance * rel + WEIGHTS.health * health + WEIGHTS.availability * availability + WEIGHTS.quality * quality;
}
