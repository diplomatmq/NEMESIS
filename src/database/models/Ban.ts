import { db } from '../db';

export interface PlayerBan {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  reason: string | null;
  banned_by: number;
  banned_until: Date | null;
  created_at: Date;
}

export class BanModel {
  /** Creates the ban of a player, or replaces the one they already have. */
  static async upsert(data: {
    telegramId: number;
    username?: string | null;
    firstName?: string | null;
    reason: string;
    bannedBy: number;
    until: Date | null;
  }): Promise<PlayerBan> {
    const result = await db.query(
      `INSERT INTO player_bans (telegram_id, username, first_name, reason, banned_by, banned_until, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (telegram_id) DO UPDATE
         SET username = EXCLUDED.username,
             first_name = EXCLUDED.first_name,
             reason = EXCLUDED.reason,
             banned_by = EXCLUDED.banned_by,
             banned_until = EXCLUDED.banned_until,
             created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        data.telegramId,
        data.username ?? null,
        data.firstName ?? null,
        data.reason,
        data.bannedBy,
        data.until,
      ]
    );
    return result.rows[0];
  }

  /** Lifts the ban of a player. Returns false when they were not banned. */
  static async remove(telegramId: number): Promise<boolean> {
    const result = await db.query(
      'DELETE FROM player_bans WHERE telegram_id = $1',
      [telegramId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** The block that is still in force for a player, or null. */
  static async getActive(telegramId: number): Promise<PlayerBan | null> {
    const result = await db.query(
      `SELECT * FROM player_bans
        WHERE telegram_id = $1
          AND (banned_until IS NULL OR banned_until > CURRENT_TIMESTAMP)`,
      [telegramId]
    );
    return result.rows[0] || null;
  }

  /** Every player who is blocked right now, newest bans first. */
  static async listActive(): Promise<PlayerBan[]> {
    const result = await db.query(
      `SELECT * FROM player_bans
        WHERE banned_until IS NULL OR banned_until > CURRENT_TIMESTAMP
        ORDER BY created_at DESC, telegram_id`
    );
    return result.rows;
  }
}
