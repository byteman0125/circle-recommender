# Circle recommendations: design notes

API (Node, Fastify, SQLite) that returns ranked Circles for a member, each with a short reason. Schema in [SCHEMA.md](SCHEMA.md).

Main idea: a recommendation is only useful if she can join it and it's alive. Full or silent Circles are worse than a decent active one. So first decide what never shows, then rank the rest.

## Flow

1. **Filter.** Drop unlisted, already joined, full (null `max_members` = uncapped), dormant (0 posts in 30d and idle 60d+). Shorter list beats a bad suggestion.
2. **Score.** 55% relevance, 30% activity, 15% joinability + size.
   - Relevance: picked topic 1.0, tag match 0.5. No picks: topics of Circles she's in (0.4).
   - Activity: posts, chat volume, recency, reactions per post.
   - Joinability: open vs request, near-full penalty. Size: 8-25 preferred, Circles are small peer groups.
3. **Duplicates.** 10/11/12 are the same Negotiation Circle three times. Keep best, return rest as `similar_circle_ids`. Same topic but different community (Elevation vs Women Who Lead) only nudged down. First try was one per topic, dropped Circle 5 for user 7. Wrong.
4. **Explain.** Template filled from real fields. "Matches your interest in X" only if she picked X. Activity only if there is some.

Cold start (user 42): relevance 0 everywhere, so healthiest open Circles, mixed topics, neutral reason.

## Choices / doubts

- Weights are my judgment, not validated. No join/click data, 100 users, so no collaborative filtering. Plain weighted score, one config file.
- Interests + memberships only. No job title/bio, guessing from profile can go wrong. Would need opt-in.
- Tags look random in this data. Weighted low, softer wording.
- "Now" fixed at snapshot date 2026-09-21. 30-day counts are frozen there, real clock would make everything look stale.
- Duplicate check is a heuristic (same topic, names built around it). Also merges Speak Up / Speak With Impact. Judgment call.
- Keyword fallback for the 2 topic-less Circles is tested but never fires on this data.

## Next / at scale

- Postgres, precomputed health table from events, rank a few hundred topic candidates, cache per member.
- Learn from outcomes (shown, clicked, joined, still active at 30d). Fit weights, A/B test. Exposure for new Circles or busy ones keep winning.
- Check for skew across member groups. Lean In is for all women, not just the active crowd.
- Embeddings for duplicates and text match. Location for in-person Circles.

## Tests / AI

34 tests: 4 planted users, every scoring branch, invariants over all 100 members, real HTTP (concurrent too), demo page in jsdom.

Used Claude Code to explore data, challenge my plan, draft code and tests. It caught the one-per-topic mistake and the real-clock problem. Checked everything myself: ran scenarios, read raw data, tested README claims. Tests found 2 explanation bugs ("lively" on a Circle with no posts, dropped "join by request"). Fixed.
