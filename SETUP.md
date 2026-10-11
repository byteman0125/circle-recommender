# Running it

Node 22.5+ (built with 24). Uses Node's built-in SQLite. Only runtime dependency: Fastify.

```bash
npm install
npm start
```

Open http://localhost:3000. First start loads `data/*.json` into `recs.db`, no separate setup. `npm run seed` does the same by hand, safe to repeat.

The page: pick a member, see the list. README's four users are labelled in the dropdown. "Show scores" shows the breakdown per Circle.

```bash
npm test          # 34 tests
npm run report    # top Circles for users 42, 7, 15, 23
```

Node may print an ExperimentalWarning about SQLite. npm scripts hide it.

## API

```
GET /users/:id/recommendations?limit=10&debug=true
```

- `limit`: 1-25, default 10
- `debug`: adds score breakdown per result

Example, user 23:

```json
{
  "user_id": 23,
  "strategy": "interests",
  "recommendations": [{
    "rank": 1,
    "circle": { "id": 22, "name": "Level Up Collective", "topic": "getting-promoted", "format": "hybrid",
                "join_policy": "request", "member_count": 14, "max_members": 20,
                "description": "...", "cover_image_url": "..." },
    "score": 0.929,
    "reasons": ["Matches your interest in Getting promoted.", "Very active, with 8 posts this month, join by request."],
    "explanation": "Matches your interest in Getting promoted. Very active, with 8 posts this month, join by request.",
    "similar_circle_ids": []
  }]
}
```

- `strategy`: `interests`, `inferred` (no picks, used her memberships) or `cold_start`
- `similar_circle_ids`: near-duplicates folded into this one
- Unknown user: 404. Bad `id` or `limit`: 400
- Also `GET /users` (member list), `GET /health`

Env vars, all optional:
- `PORT`, default 3000
- `RECS_DB`, database path
- `RECS_NOW`, what "now" means. Defaults to snapshot date 2026-09-21, not the real clock, since the 30-day numbers are frozen there
