# Schema

[`src/db/schema.sql`](../src/db/schema.sql), loaded by `npm run seed`. SQLite, nothing SQLite-specific, ports to Postgres.

```
users ──< memberships >── circles ──< posts
  │                          │  │
  └──< user_topics >── topics ──< circle_tags
                         ^
                         └── circles.topic_id (nullable)
```

## Tables

- `topics`: taxonomy
- `users`, `circles`: main entities
- `memberships`: user x circle, role = member | leader
- `user_topics`, `circle_tags`: interests/tags were arrays in the JSON, split out so they join and index
- `posts`: feed activity

Nullable on purpose, matches the data: `circles.topic_id` (2 Circles have none), `circles.max_members` (null = no cap). FKs everywhere. CHECKs on `format`, `access`, `join_policy`, `role`.

## Indexes

Primary keys cover most lookups: `memberships(user_id, circle_id)` for "what is she in" and no double joins, `user_topics` for interests.

Extra:
- `memberships(circle_id)`: members/leaders of a Circle
- `circles(topic_id)`: candidates by topic
- `circles(access, last_activity_at)`: public, recently active
- `posts(circle_id, created_at)`: engagement over a window
- `circle_tags(topic_id)`: Circles tagged with a topic

40 Circles, so none of it matters for speed today. Put where the queries want them at scale.

## Decisions

- `member_count`, 30-day post/chat counts, `last_activity_at` stored on `circles`, as given. Cheap at ranking time. In prod an event job keeps them current.
- Full / dormant / health computed at query time, not stored. Thresholds change without a migration.
- Seed wipes and reloads in one transaction. Safe to re-run.
