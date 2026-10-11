-- SQLite schema for the Circle recommender. See docs/DESIGN.md for rationale.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS topics (
  id    INTEGER PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  joined_at            TEXT NOT NULL,
  profile_completeness REAL NOT NULL DEFAULT 0
);

-- stated interests (normalised from users.topic_interests[])
CREATE TABLE IF NOT EXISTS user_topics (
  user_id  INTEGER NOT NULL REFERENCES users(id),
  topic_id INTEGER NOT NULL REFERENCES topics(id),
  PRIMARY KEY (user_id, topic_id)
);

CREATE TABLE IF NOT EXISTS circles (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  description       TEXT,
  topic_id          INTEGER REFERENCES topics(id),   -- NULL for topic-less Circles
  cover_image_url   TEXT,
  format            TEXT NOT NULL CHECK (format IN ('in_person','virtual','hybrid')),
  access            TEXT NOT NULL CHECK (access IN ('public','unlisted')),
  join_policy       TEXT NOT NULL CHECK (join_policy IN ('open','request')),
  max_members       INTEGER,                         -- NULL = uncapped
  member_count      INTEGER NOT NULL,                -- denormalised; see DESIGN.md
  created_at        TEXT NOT NULL,
  last_activity_at  TEXT NOT NULL,
  feed_posts_30d    INTEGER NOT NULL,
  chat_messages_30d INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS circle_tags (
  circle_id INTEGER NOT NULL REFERENCES circles(id),
  topic_id  INTEGER NOT NULL REFERENCES topics(id),
  PRIMARY KEY (circle_id, topic_id)
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id   INTEGER NOT NULL REFERENCES users(id),
  circle_id INTEGER NOT NULL REFERENCES circles(id),
  role      TEXT NOT NULL CHECK (role IN ('member','leader')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (user_id, circle_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id             INTEGER PRIMARY KEY,
  circle_id      INTEGER NOT NULL REFERENCES circles(id),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  body           TEXT NOT NULL,
  reaction_count INTEGER NOT NULL,
  comment_count  INTEGER NOT NULL,
  save_count     INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);

-- Indexes: PKs already serve "circles of a user" (memberships) and "interests of a user".
CREATE INDEX IF NOT EXISTS idx_memberships_circle ON memberships(circle_id);      -- members/leaders of a Circle
CREATE INDEX IF NOT EXISTS idx_circles_topic      ON circles(topic_id);           -- candidate generation by topic
CREATE INDEX IF NOT EXISTS idx_circles_access     ON circles(access, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_posts_circle_time  ON posts(circle_id, created_at); -- engagement windows
CREATE INDEX IF NOT EXISTS idx_circle_tags_topic  ON circle_tags(topic_id);
