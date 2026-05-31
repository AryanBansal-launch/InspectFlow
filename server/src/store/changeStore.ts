import { randomUUID } from "node:crypto";
import type { StyleChange } from "../validation/schemas.js";

/**
 * A captured style change with server-assigned identity and timestamp.
 */
export interface StoredStyleChange extends StyleChange {
  id: string;
  receivedAt: string;
}

/**
 * In-memory ring buffer of recently captured style changes.
 *
 * The MVP keeps state in process — there is no database. The buffer is bounded
 * so a long-running session cannot grow memory without limit. Most-recent
 * changes are returned first.
 */
export class ChangeStore {
  private readonly changes: StoredStyleChange[] = [];

  constructor(private readonly capacity: number = 200) {
    if (capacity <= 0) {
      throw new Error("ChangeStore capacity must be a positive integer");
    }
  }

  /**
   * Records a new style change and returns the stored representation.
   */
  add(change: StyleChange, receivedAt: string): StoredStyleChange {
    const stored: StoredStyleChange = {
      ...change,
      id: randomUUID(),
      receivedAt,
    };

    this.changes.unshift(stored);
    if (this.changes.length > this.capacity) {
      this.changes.length = this.capacity;
    }

    return stored;
  }

  /**
   * Returns up to `limit` most-recent changes (newest first).
   */
  list(limit = 50): StoredStyleChange[] {
    return this.changes.slice(0, Math.max(0, limit));
  }

  /**
   * Looks up a single change by id.
   */
  get(id: string): StoredStyleChange | undefined {
    return this.changes.find((change) => change.id === id);
  }

  /**
   * Returns the most-recently captured change, if any.
   */
  latest(): StoredStyleChange | undefined {
    return this.changes[0];
  }

  /**
   * Number of changes currently retained.
   */
  size(): number {
    return this.changes.length;
  }

  /**
   * Clears all captured changes.
   */
  clear(): void {
    this.changes.length = 0;
  }
}

/**
 * Process-wide singleton used by both the HTTP routes and the MCP tools so they
 * share the same captured-change history.
 */
export const changeStore = new ChangeStore();
