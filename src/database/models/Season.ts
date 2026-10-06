import { db } from '../db';

export interface Season {
  id: number;
  season_number: number;
  start_date: Date;
  end_date: Date;
  is_active: boolean;
  total_floors: number;
  zones_count: number;
  created_at: Date;
}

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
      // Create first season
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      
      season = await this.create({
        season_number: 1,
        start_date: startOfMonth,
        end_date: endOfMonth,
      });
    }
    
    return season;
  }
}
