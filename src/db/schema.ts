import {
  pgTable,
  text,
  bigint,
  jsonb,
  serial,
  index,
} from "drizzle-orm/pg-core";

// Sessions: one row per teaching session.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  lessonId: text("lesson_id"),
  phase: text("phase").notNull().default("created"),
  meetingUrl: text("meeting_url"),
  botId: text("bot_id"),
  characterSessionId: text("character_session_id"),
  browserSessionId: text("browser_session_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const transcripts = pgTable(
  "transcripts",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    speaker: text("speaker").notNull(),
    text: text("text").notNull(),
  },
  (t) => [index("transcripts_session_idx").on(t.sessionId)],
);

export const traces = pgTable(
  "traces",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => [index("traces_session_idx").on(t.sessionId)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
  },
  (t) => [index("artifacts_session_idx").on(t.sessionId)],
);

export const progress = pgTable("progress", {
  sessionId: text("session_id").primaryKey(),
  lessonId: text("lesson_id").notNull(),
  stepIndex: bigint("step_index", { mode: "number" }).notNull(),
  done: text("done").notNull().default("false"),
  state: jsonb("state").notNull(),
});
