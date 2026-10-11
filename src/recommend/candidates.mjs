// Data access for the recommender: one user context + all Circles with their signals.
import { NOW } from "./config.mjs";

export function loadUserContext(db, userId) {
  const user = db.prepare("SELECT id, first_name, profile_completeness FROM users WHERE id = ?").get(userId);
  if (!user) return null;
  const stated = db
    .prepare("SELECT t.slug, t.label FROM user_topics ut JOIN topics t ON t.id = ut.topic_id WHERE ut.user_id = ? ORDER BY t.id")
    .all(userId);
  const memberOf = db
    .prepare(
      `SELECT m.circle_id, t.slug AS topic_slug, t.label AS topic_label
         FROM memberships m JOIN circles c ON c.id = m.circle_id LEFT JOIN topics t ON t.id = c.topic_id
        WHERE m.user_id = ?`,
    )
    .all(userId);
  return { user, stated, memberOf };
}

// All Circles with topic slug/label, tags, and avg engagement per post.
export function loadCircles(db) {
  const rows = db
    .prepare(
      `SELECT c.*, t.slug AS topic_slug, t.label AS topic_label,
              (SELECT AVG(p.reaction_count + p.comment_count + p.save_count) FROM posts p WHERE p.circle_id = c.id) AS avg_engagement
         FROM circles c LEFT JOIN topics t ON t.id = c.topic_id ORDER BY c.id`,
    )
    .all();
  const tags = db.prepare("SELECT ct.circle_id, t.slug, t.label FROM circle_tags ct JOIN topics t ON t.id = ct.topic_id").all();
  const byCircle = new Map();
  for (const t of tags) {
    if (!byCircle.has(t.circle_id)) byCircle.set(t.circle_id, []);
    byCircle.get(t.circle_id).push({ slug: t.slug, label: t.label });
  }
  return rows.map((r) => ({
    ...r,
    tags: byCircle.get(r.id) ?? [],
    days_since_activity: (NOW.getTime() - Date.parse(r.last_activity_at)) / 86400000,
    avg_engagement: r.avg_engagement ?? 0,
  }));
}
