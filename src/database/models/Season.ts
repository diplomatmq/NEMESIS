import { db } from '../db';

export interface Season {
  id: number;
  season_number: number;
  start_date: Date;
  end_date: Date;
  is_active: boolean;
  is_finished: boolean;
  total_floors: number;
  zones_count: number;
  created_at: Date;
}

/** A tournament runs for exactly three weeks. */
export const SEASON_DURATION_MS = 21 * 24 * 60 * 60 * 1000;

export class SeasonModel {
  static async getCurrentSeason(): Promise<Season | null> {
    const result = await db.query(
      'SELECT * FROM seasons WHERE is_active = true ORDER BY season_number DESC LIMIT 1'
    );
    return result.rows[0] || null;
  }

  static async create(data: {
    season_number: number;
    start_date: Date;
    end_date: Date;
    total_floors?: number;
    zones_count?: number;
  }): Promise<Season> {
    const result = await db.query(
      `INSERT INTO seasons (season_number, start_date, end_date, is_active, total_floors, zones_count)
       VALUES ($1, $2, $3, true, $4, $5)
       RETURNING *`,
      [
        data.season_number,
        data.start_date,
        data.end_date,
        data.total_floors || 500,
        data.zones_count || 50,
      ]
    );
    return result.rows[0];
  }

  static async deactivateAll(): Promise<void> {
    await db.query('UPDATE seasons SET is_active = false');
  }

  static async getOrCreateCurrentSeason(): Promise<Season> {
    let season = await this.getCurrentSeason();

    if (!season) {
      // The season that exists before an administrator runs /sstart is the
      // test season 0: everyone's progress is kept, but it is never reported
      // as a finished tournament.
      const now = new Date();
      season = await this.create({
        season_number: 0,
        start_date: now,
        end_date: new Date(now.getTime() + SEASON_DURATION_MS),
      });
    }

    return season;
  }

  static async getMaxSeasonNumber(): Promise<number> {
    const result = await db.query('SELECT COALESCE(MAX(season_number), 0) AS max FROM seasons');
    return Number(result.rows[0].max);
  }

  /** The most recently finished tournament, used for the player's statistics. */
  static async getLastFinishedSeason(): Promise<Season | null> {
    const result = await db.query(
      'SELECT * FROM seasons WHERE is_finished = true ORDER BY season_number DESC LIMIT 1'
    );
    return result.rows[0] || null;
  }

  /** The active real season whose end date has already passed. */
  static async getExpiredActiveSeason(): Promise<Season | null> {
    // Season dates are stored as UTC wall-clock values, so they are compared
    // against the current UTC time rather than the session's local time.
    const result = await db.query(
      `SELECT * FROM seasons
       WHERE is_active = true AND is_finished = false AND season_number >= 1
         AND end_date <= (NOW() AT TIME ZONE 'UTC')
       ORDER BY season_number DESC LIMIT 1`
    );
    return result.rows[0] || null;
  }

  /**
   * Flips the finished flag exactly once. Returns true only for the caller
   * that actually performed the transition, so the announcement is not
   * duplicated across processes.
   */
  static async markFinished(id: number): Promise<boolean> {
    const result = await db.query(
      'UPDATE seasons SET is_finished = true WHERE id = $1 AND is_finished = false RETURNING id',
      [id]
    );
    return result.rows.length > 0;
  }
}
