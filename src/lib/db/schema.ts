import { pgTable, uuid, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  firstName: text("first_name").notNull(),
  org: text("org").notNull().default("ARag, Inc."),
  initials: text("initials").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type UserRow = typeof users.$inferSelect;

export const threads = pgTable("threads", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  threadId: uuid("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  answerText: text("answer_text").notNull(),
  tokens: integer("tokens").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const citations = pgTable("citations", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  documentId: text("document_id").notNull(),
  documentTitle: text("document_title").notNull(),
  chunkId: text("chunk_id").notNull(),
  sectionId: text("section_id").notNull(),
  headingPath: text("heading_path").notNull().default(""),
  snippet: text("snippet").notNull(),
});

export type ThreadRow = typeof threads.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type CitationRow = typeof citations.$inferSelect;
