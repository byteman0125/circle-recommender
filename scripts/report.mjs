// Prints top results for the planted scenarios + coverage stats.  `npm run report`
import { openDb } from "../src/db/index.mjs";
import { seed } from "../src/db/seed.mjs";
import { recommend } from "../src/recommend/index.mjs";

const db = openDb(":memory:");
seed(db);
for (const id of [42, 7, 15, 23]) {
  const r = recommend(db, id, { limit: 6 });
  console.log(`\n== user ${id} (${r.strategy})`);
  for (const x of r.recommendations) {
    const sim = x.similar_circle_ids.length ? ` ~similar:${x.similar_circle_ids}` : "";
    console.log(`  #${x.rank} [${x.circle.id}] ${x.circle.name} (${x.circle.topic}) ${x.score}${sim}\n       ${x.explanation}`);
  }
}
let short = 0;
for (let id = 1; id <= 100; id++) if (recommend(db, id).recommendations.length < 10) short++;
console.log(`\nusers with <10 results: ${short}/100`);
