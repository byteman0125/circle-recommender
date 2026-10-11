import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "./db/index.mjs";
import { ensureSeeded } from "./db/seed.mjs";
import { recommend } from "./recommend/index.mjs";
import { LIMITS } from "./recommend/config.mjs";

export function buildServer(db = openDb()) {
  ensureSeeded(db); // fresh checkout / empty DB: load data/*.json instead of 404-ing every user
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.get("/health", async () => ({ ok: true }));

  // Demo UI: one static page + a member list for its dropdown.
  const page = readFileSync(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8");
  app.get("/", async (_req, reply) => reply.type("text/html; charset=utf-8").send(page));
  app.get("/favicon.ico", async (_req, reply) => reply.code(204).send());
  app.get("/users", async () => {
    const interests = new Map();
    for (const r of db.prepare("SELECT ut.user_id, t.label FROM user_topics ut JOIN topics t ON t.id = ut.topic_id ORDER BY t.id").all()) {
      if (!interests.has(r.user_id)) interests.set(r.user_id, []);
      interests.get(r.user_id).push(r.label);
    }
    return db.prepare("SELECT id, first_name, last_name FROM users ORDER BY id").all()
      .map((u) => ({ id: u.id, name: `${u.first_name} ${u.last_name}`, interests: interests.get(u.id) ?? [] }));
  });

  app.get(
    "/users/:id/recommendations",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "integer", minimum: 1 } }, required: ["id"] },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: LIMITS.max },
            debug: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply) => {
      const result = recommend(db, req.params.id, { limit: req.query.limit ?? LIMITS.default, debug: req.query.debug === true });
      if (!result) return reply.code(404).send({ error: "user_not_found", message: `No user with id ${req.params.id}` });
      return result;
    },
  );
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  await buildServer().listen({ port, host: "0.0.0.0" });
}
