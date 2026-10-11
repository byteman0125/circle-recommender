// Loads data/*.json into SQLite. Idempotent: wipes and reloads inside one transaction.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, ROOT, DEFAULT_DB_PATH } from "./index.mjs";

const load = (name) => JSON.parse(readFileSync(join(ROOT, "data", `${name}.json`), "utf8"));

export function seed(db) {
  const topics = load("topics");
  const users = load("users");
  const circles = load("circles");
  const memberships = load("memberships");
  const activity = load("activity");
  const topicId = new Map(topics.map((t) => [t.slug, t.id]));

  db.exec("BEGIN");
  try {
    for (const t of ["posts", "memberships", "circle_tags", "circles", "user_topics", "users", "topics"]) {
      db.exec(`DELETE FROM ${t}`);
    }
    const ins = (sql) => db.prepare(sql);
    const iTopic = ins("INSERT INTO topics (id, slug, label) VALUES (?,?,?)");
    for (const t of topics) iTopic.run(t.id, t.slug, t.label);

    const iUser = ins("INSERT INTO users (id, first_name, last_name, joined_at, profile_completeness) VALUES (?,?,?,?,?)");
    const iUT = ins("INSERT INTO user_topics (user_id, topic_id) VALUES (?,?)");
    for (const u of users) {
      iUser.run(u.id, u.first_name, u.last_name, u.joined_at, u.profile_completeness);
      for (const s of new Set(u.topic_interests)) iUT.run(u.id, topicId.get(s));
    }

    const iCircle = ins(`INSERT INTO circles (id, name, slug, description, topic_id, cover_image_url, format, access,
      join_policy, max_members, member_count, created_at, last_activity_at, feed_posts_30d, chat_messages_30d)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const iTag = ins("INSERT INTO circle_tags (circle_id, topic_id) VALUES (?,?)");
    for (const c of circles) {
      iCircle.run(c.id, c.name, c.slug, c.description, c.topic ? topicId.get(c.topic) : null, c.cover_image_url,
        c.format, c.access, c.join_policy, c.max_members, c.member_count, c.created_at, c.last_activity_at,
        c.feed_posts_30d, c.chat_messages_30d);
      for (const s of new Set(c.tags)) iTag.run(c.id, topicId.get(s));
    }

    const iMem = ins("INSERT INTO memberships (user_id, circle_id, role, joined_at) VALUES (?,?,?,?)");
    for (const m of memberships) iMem.run(m.user_id, m.circle_id, m.role, m.joined_at);

    const iPost = ins(`INSERT INTO posts (id, circle_id, author_user_id, body, reaction_count, comment_count,
      save_count, created_at) VALUES (?,?,?,?,?,?,?,?)`);
    for (const p of activity) {
      iPost.run(p.id, p.circle_id, p.author_user_id, p.body, p.reaction_count, p.comment_count, p.save_count, p.created_at);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { topics: topics.length, users: users.length, circles: circles.length, memberships: memberships.length, posts: activity.length };
}

/** Seeds only if the DB is empty, so `npm start` works on a fresh checkout. */
export function ensureSeeded(db) {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get();
  if (n === 0) return seed(db);
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  console.log("seeded", DEFAULT_DB_PATH, seed(db));
}
