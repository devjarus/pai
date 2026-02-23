import { randomUUID } from "node:crypto";
import type { Migration, Storage, ChatMessage } from "./types.js";

/** Thread persistence migrations — shared by server and telegram bot */
export const threadMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New conversation',
        agent_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS thread_messages (
        thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
        messages_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    up: `
      PRAGMA foreign_keys=OFF;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT 'Local User',
        created_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO users (id, display_name, created_at)
      VALUES ('user-local', 'Local User', datetime('now'));

      ALTER TABLE threads RENAME TO threads_legacy;
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New conversation',
        agent_name TEXT,
        user_id TEXT NOT NULL DEFAULT 'user-local' REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO threads (id, title, agent_name, user_id, created_at, updated_at, message_count)
      SELECT id, title, agent_name, 'user-local', created_at, updated_at, message_count FROM threads_legacy;

      ALTER TABLE thread_messages RENAME TO thread_messages_legacy;
      CREATE TABLE IF NOT EXISTS thread_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        parts_json TEXT,
        created_at TEXT NOT NULL,
        sequence INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_sequence
        ON thread_messages (thread_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_created
        ON thread_messages (thread_id, created_at);

      INSERT INTO thread_messages (id, thread_id, role, content, parts_json, created_at, sequence)
      SELECT
        lower(hex(randomblob(16))),
        tm.thread_id,
        json_extract(j.value, '$.role'),
        json_extract(j.value, '$.content'),
        NULL,
        tm.updated_at,
        CAST(j.key AS INTEGER) + 1
      FROM thread_messages_legacy tm, json_each(tm.messages_json) j;

      UPDATE threads
      SET message_count = (
        SELECT COUNT(*) FROM thread_messages WHERE thread_id = threads.id
      );

      DROP TABLE thread_messages_legacy;
      DROP TABLE threads_legacy;

      PRAGMA foreign_keys=ON;
    `,
  },
  {
    version: 3,
    up: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_messages_unique_seq
        ON thread_messages (thread_id, sequence);
    `,
  },
];

export const DEFAULT_USER_ID = "user-local";

export interface ThreadRow {
  id: string;
  title: string;
  agent_name: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface ThreadMessageRow {
  id: string;
  thread_id: string;
  role: ChatMessage["role"];
  content: string;
  parts_json: string | null;
  created_at: string;
  sequence: number;
}

export interface ThreadMessageInput {
  role: ChatMessage["role"];
  content: string;
  partsJson?: string | null;
  createdAt?: string;
}

export interface EnsureThreadOptions {
  id?: string;
  title?: string;
  agentName?: string;
  userId?: string;
}

export interface ListMessagesOptions {
  limit?: number;
  before?: string;
}

export interface AppendMessagesOptions {
  maxMessages?: number;
  titleCandidate?: string;
  now?: string;
}

export function getThread(storage: Storage, id: string): ThreadRow | null {
  const rows = storage.query<ThreadRow>("SELECT * FROM threads WHERE id = ?", [id]);
  return rows[0] ?? null;
}

export function listThreads(storage: Storage, userId: string = DEFAULT_USER_ID): ThreadRow[] {
  return storage.query<ThreadRow>(
    "SELECT id, title, agent_name, user_id, created_at, updated_at, message_count FROM threads WHERE user_id = ? ORDER BY updated_at DESC",
    [userId],
  );
}

export function createThread(storage: Storage, opts: { title?: string; agentName?: string; userId?: string } = {}): ThreadRow {
  const id = `thread-${randomUUID()}`;
  const now = new Date().toISOString();
  const title = opts.title ?? "New conversation";
  const agentName = opts.agentName ?? null;
  const userId = opts.userId ?? DEFAULT_USER_ID;

  const tx = storage.db.transaction(() => {
    storage.run(
      "INSERT INTO threads (id, title, agent_name, user_id, created_at, updated_at, message_count) VALUES (?, ?, ?, ?, ?, ?, 0)",
      [id, title, agentName, userId, now, now],
    );
  });
  tx();

  return { id, title, agent_name: agentName, user_id: userId, created_at: now, updated_at: now, message_count: 0 };
}

export function ensureThread(storage: Storage, opts: EnsureThreadOptions = {}): { thread: ThreadRow; created: boolean } {
  if (opts.id) {
    const existing = getThread(storage, opts.id);
    if (existing) return { thread: existing, created: false };
  }
  const thread = createThread(storage, { title: opts.title, agentName: opts.agentName, userId: opts.userId });
  return { thread, created: true };
}

export function listMessages(storage: Storage, threadId: string, opts: ListMessagesOptions = {}): ThreadMessageRow[] {
  const limit = opts.limit ?? 50;
  let beforeSequence: number | undefined;
  if (opts.before) {
    const asNumber = Number(opts.before);
    if (Number.isFinite(asNumber)) {
      beforeSequence = asNumber;
    } else {
      const rows = storage.query<{ sequence: number }>(
        "SELECT sequence FROM thread_messages WHERE id = ?",
        [opts.before],
      );
      beforeSequence = rows[0]?.sequence;
    }
  }

  const rows = beforeSequence
    ? storage.query<ThreadMessageRow>(
      "SELECT id, thread_id, role, content, parts_json, created_at, sequence FROM thread_messages WHERE thread_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?",
      [threadId, beforeSequence, limit],
    )
    : storage.query<ThreadMessageRow>(
      "SELECT id, thread_id, role, content, parts_json, created_at, sequence FROM thread_messages WHERE thread_id = ? ORDER BY sequence DESC LIMIT ?",
      [threadId, limit],
    );

  return rows.reverse();
}

export function appendMessages(storage: Storage, threadId: string, messages: ThreadMessageInput[], opts: AppendMessagesOptions = {}): void {
  if (messages.length === 0) return;
  const now = opts.now ?? new Date().toISOString();

  const tx = storage.db.transaction(() => {
    const seqRow = storage.query<{ seq: number }>(
      "SELECT COALESCE(MAX(sequence), 0) AS seq FROM thread_messages WHERE thread_id = ?",
      [threadId],
    );
    let seq = seqRow[0]?.seq ?? 0;

    for (const msg of messages) {
      seq += 1;
      storage.run(
        "INSERT INTO thread_messages (id, thread_id, role, content, parts_json, created_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          `msg-${randomUUID()}`,
          threadId,
          msg.role,
          msg.content,
          msg.partsJson ?? null,
          msg.createdAt ?? now,
          seq,
        ],
      );
    }

    if (opts.maxMessages) {
      const countRow = storage.query<{ count: number }>(
        "SELECT COUNT(*) AS count FROM thread_messages WHERE thread_id = ?",
        [threadId],
      );
      const total = countRow[0]?.count ?? 0;
      if (total > opts.maxMessages) {
        const toDelete = total - opts.maxMessages;
        storage.run(
          "DELETE FROM thread_messages WHERE id IN (SELECT id FROM thread_messages WHERE thread_id = ? ORDER BY sequence ASC LIMIT ?)",
          [threadId, toDelete],
        );
      }
    }

    const finalCountRow = storage.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM thread_messages WHERE thread_id = ?",
      [threadId],
    );
    const finalCount = finalCountRow[0]?.count ?? 0;

    if (opts.titleCandidate) {
      storage.run(
        "UPDATE threads SET updated_at = ?, message_count = ?, title = CASE WHEN title = 'New conversation' THEN ? ELSE title END WHERE id = ?",
        [now, finalCount, opts.titleCandidate, threadId],
      );
    } else {
      storage.run(
        "UPDATE threads SET updated_at = ?, message_count = ? WHERE id = ?",
        [now, finalCount, threadId],
      );
    }
  });

  tx();
}

export function clearThread(storage: Storage, threadId: string): void {
  const now = new Date().toISOString();
  storage.run("DELETE FROM thread_messages WHERE thread_id = ?", [threadId]);
  storage.run("UPDATE threads SET updated_at = ?, message_count = 0 WHERE id = ?", [now, threadId]);
}

export function deleteThread(storage: Storage, threadId: string): void {
  storage.run("DELETE FROM thread_messages WHERE thread_id = ?", [threadId]);
  storage.run("DELETE FROM threads WHERE id = ?", [threadId]);
}

const threadQueues = new Map<string, Promise<unknown>>();

export function withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const prev = threadQueues.get(threadId) ?? Promise.resolve();
  const chain = prev.then(fn, fn);
  const safe = chain.catch(() => {});
  threadQueues.set(threadId, safe);
  safe.then(() => {
    if (threadQueues.get(threadId) === safe) {
      threadQueues.delete(threadId);
    }
  });
  return chain;
}
