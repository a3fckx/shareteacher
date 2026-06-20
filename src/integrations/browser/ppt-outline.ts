// ─────────────────────────────────────────────────────────────────────────
// PPT outline helpers (Organ 4 support).
//
// These helpers recognize a slide-deck prompt and return a believable
// multi-slide outline so Lesson 1 ("Create a PPT using ChatGPT") runs
// end-to-end even when a live ChatGPT response isn't available. They are pure +
// deterministic so the lesson looks the same every run.
// ─────────────────────────────────────────────────────────────────────────

/** Default presentation topic when no human has provided one (matches s1). */
export const DEFAULT_TOPIC = "The Future of Renewable Energy";

/** Heuristic: does this typed text read like a slide-deck / PPT request? */
export function looksLikePptPrompt(text: string): boolean {
  return /\b(slide|slides|powerpoint|power\s?point|ppt|presentation|deck|outline)\b/i.test(
    text ?? "",
  );
}

/**
 * Best-effort topic extraction from a free-form PPT prompt. Falls back to the
 * default topic so the helper always returns a coherent outline.
 */
export function extractTopic(prompt: string): string {
  const raw = prompt ?? "";
  if (!raw.trim()) return DEFAULT_TOPIC;

  // 0) Explicit "Topic:" label (the canonical orchestrator prompt shape).
  //    Match before collapsing whitespace so a newline ends the value.
  const labelled = raw.match(/\btopic\s*[:\-]\s*([^.\n]{3,120})/i);
  if (labelled?.[1]) return cleanTopic(labelled[1]);

  const text = raw.replace(/\s+/g, " ").trim();

  // 1) Quoted topic after a lead-in word.
  const quoted = text.match(
    /(?:about|on|regarding|titled?|topic(?:\s+of)?|for|titled)\s+["“'`]([^"”'`]{3,120})["”'`]/i,
  );
  if (quoted?.[1]) return cleanTopic(quoted[1]);

  // 2) "<create verb> ... <deck noun> on/about <Topic>" — anchored on an intent
  //    verb so instruction tails like "a slide on costs and ROI" don't match.
  const verbed = text.match(
    /\b(?:create|make|build|design|generate|prepare|need|want|produce|put together)\b[^.\n]*?\b(?:presentation|deck|slides?|powerpoint|power\s?point|ppt)\b\s+(?:on|about|covering|titled?|for)\s+([^.,;:\n]{3,90})/i,
  );
  if (verbed?.[1]) return cleanTopic(verbed[1]);

  // 3) Generic "on/about <Topic>".
  const generic = text.match(/\b(?:on|about)\s+([A-Za-z0-9][^.,;:\n]{3,90})/i);
  if (generic?.[1]) return cleanTopic(generic[1]);

  return DEFAULT_TOPIC;
}

/** Trim trailing audience/tone clauses and stray punctuation from a topic. */
function cleanTopic(raw: string): string {
  let t = raw.trim();
  // Drop a leading slide/page count, e.g. "10-12 slide ", but never a bare
  // number glued to a word (so "3D Printing" survives).
  t = t.replace(/^\d+[\s-]*\d*\s*(?:slide|slides|page|pages)\s+/i, "");
  // Cut audience/tone tails introduced with an article:
  // "for a business audience", "in a formal tone", "with the board".
  t = t.replace(/\s+(?:for|in|with|to)\s+(?:a|an|the)\s+.*$/i, "");
  // Cut article-less audience tails: "for executives", "for beginners".
  t = t.replace(
    /\s+for\s+(?:executives?|managers?|beginners?|students?|leaders?|professionals?|engineers?|business(?:\s+\w+)?|general\s+\w+|board|teams?|stakeholders?|customers?|clients?|investors?|audiences?)\b.*$/i,
    "",
  );
  // Cut a trailing label such as "audience:" / "tone:" if it leaked in.
  t = t.split(/\s+(?:audience|tone|slides?|format)\s*[:\-]/i)[0] ?? t;
  t = t.replace(/["“”'`]/g, "").replace(/[\s.,;:–—-]+$/g, "").trim();
  return t.length >= 3 ? t : DEFAULT_TOPIC;
}

/**
 * Build a strong, reusable PPT prompt for a topic. Exported so the orchestrator
 * (and this module's own detection) share one canonical prompt shape.
 */
export function buildPptPrompt(topic: string): string {
  return [
    "Act as an expert presentation designer and subject-matter expert.",
    "Create a detailed, slide-by-slide outline for a PowerPoint presentation.",
    "",
    `Topic: ${topic}`,
    "Audience: a general business audience",
    "Slides: 10-12",
    "Tone: clear, professional, and engaging",
    "",
    "For each slide give a short title and 2-3 concise bullet points.",
    "Include a title slide, an agenda, several content slides, a dedicated",
    "slide on costs and ROI, and a closing slide.",
  ].join("\n");
}

/**
 * Render a believable 12-slide outline (title, agenda, content, costs/ROI,
 * closing) derived from `topic`. Deterministic for a given topic.
 */
export function buildPptOutline(topic: string): string {
  const t = (topic || DEFAULT_TOPIC).trim();
  const slides = [
    `SLIDE 1 — Title
• ${t}
• A practical, strategic overview
• Presented with the ShareTeacher AI teacher`,

    `SLIDE 2 — Agenda
• Why ${t} matters now
• Core concepts and how it works
• Real-world applications
• Costs, ROI, and a 90-day roadmap`,

    `SLIDE 3 — Introduction & Context
• What we mean by "${t}"
• The problem it addresses today
• Who should care, and why now`,

    `SLIDE 4 — Why ${t} Matters
• The momentum and market behind it
• The cost of standing still
• The opportunity in one sentence`,

    `SLIDE 5 — Core Concepts
• Three ideas that explain ${t}
• Common misconceptions, cleared up
• A simple mental model to keep`,

    `SLIDE 6 — How It Works
• The high-level flow, step by step
• The key moving parts
• What a strong result looks like`,

    `SLIDE 7 — Real-World Applications
• Where ${t} is already used
• A short, concrete example
• Early results and signals`,

    `SLIDE 8 — Challenges & Considerations
• Practical obstacles to expect
• Trade-offs and constraints
• How teams reduce the risk`,

    `SLIDE 9 — Costs & ROI
• The main cost drivers
• Expected return and payback window
• A simple before / after comparison`,

    `SLIDE 10 — Implementation Roadmap
• A 30 / 60 / 90 day plan
• Owners and milestones
• How progress is measured`,

    `SLIDE 11 — Key Takeaways
• Three things to remember about ${t}
• The single most important next step
• Where to go deeper`,

    `SLIDE 12 — Thank You
• Questions and discussion
• Contact and follow-up
• Reusable prompt template attached`,
  ];

  return `Here is a 12-slide PowerPoint outline for "${t}":\n\n${slides.join(
    "\n\n",
  )}`;
}
