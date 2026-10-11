// Member-facing reasons, built only from facts we actually have. Warm, short, second person.
import { spotsLeft } from "./score.mjs";

function whyMatch(rel, strategy, c) {
  switch (rel.kind) {
    case "stated": return `Matches your interest in ${rel.topic}.`;
    case "tag": return `Covers ${rel.topic}, one of your interests.`;
    case "keyword": return `Looks relevant to your interest in ${rel.topic}.`;
    case "inferred": return `Similar to ${rel.topic} Circles you've already joined.`;
    case "inferred_tag": return `Touches on ${rel.topic}, like Circles you've joined.`;
    default:
      if (strategy === "cold_start") return "A welcoming place to get started.";
      return c.feed_posts_30d >= 2 ? "A lively Circle other members are enjoying." : "Another Circle worth a look.";
  }
}

function whyActive(c) {
  const n = c.feed_posts_30d;
  if (n >= 8) return `very active, with ${n} posts this month`;
  if (n >= 2) return `${n} posts this month`;
  if (n === 1) return "1 post this month";
  return null;
}

function whyAvailability(c) {
  const spots = spotsLeft(c);
  const policy = c.join_policy === "open" ? "open to join" : "join by request";
  if (spots !== null && spots <= 2) return `only ${spots} spot${spots === 1 ? "" : "s"} left, ${policy}`;
  return policy;
}

export function explain(c, rel, strategy) {
  const reasons = [whyMatch(rel, strategy, c)];
  const tail = [whyActive(c), whyAvailability(c)].filter(Boolean);
  const sentence = tail.join(", ");
  reasons.push(`${sentence[0].toUpperCase()}${sentence.slice(1)}.`);
  return { reasons, explanation: reasons.join(" ") };
}
