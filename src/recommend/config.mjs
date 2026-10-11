// All tunables in one place. Weights are heuristic (no ground-truth labels exist) -
// see docs/DESIGN.md for the rationale and how we'd learn them in production.
export const NOW = new Date(process.env.RECS_NOW || "2026-09-21T00:00:00Z"); // dataset snapshot date, not wall clock

export const WEIGHTS = { relevance: 0.55, health: 0.3, availability: 0.1, quality: 0.05 };

export const RELEVANCE = {
  statedTopic: 1.0, // Circle topic is one of the member's stated interests
  statedTag: 0.5, // ...or appears in the Circle's tags
  keyword: 0.6, // topic-less Circle whose name/description mentions a stated interest
  inferredTopic: 0.4, // topic of a Circle the member already belongs to (only if they stated nothing)
  inferredTag: 0.2,
};

export const HEALTH = {
  postsCap: 20,
  chatCap: 220,
  engagementCap: 25,
  recencyHalfLifeDays: 14,
  parts: { posts: 0.4, chat: 0.2, recency: 0.25, engagement: 0.15 },
};

export const DORMANT = { maxDaysSinceActivity: 60 }; // AND zero posts in 30d
export const NEAR_FULL_SPOTS = 2;
export const PEER_SIZE = { min: 8, max: 25 }; // Circles are small peer groups
export const DIVERSITY = { sameTopicPenalty: 0.75, coldStartSameTopicPenalty: 0.5 };
export const LIMITS = { default: 10, max: 25 };
