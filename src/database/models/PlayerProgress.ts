import { db } from '../db';

export interface PlayerProgress {
  id: number;
  user_id: number;
  chat_id: number;
  season_id: number;
  class_id?: number;
  floor: number;
  hp: number;
  max_hp: number;
  attack: number;
  defense: number;
  gold: number;
  xp: number;
  level: number;
  checkpoint_floor: number;
  current_enemy_id?: number;
  created_at: Date;
  updated_at: Date;
}

export class PlayerProgressModel {
  static async find(userId: number, chatId: number, seasonId: number): Promise<PlayerProgress | null> {
    const result = await db.query(
      'SELECT * FROM player_progress WHERE user_id = $1 AND chat_id = $2 AND season_id = $3',
      [userId, chatId, seasonId]
    );
    return result.rows[0] || null;
  }

  static async create(data: {
    user_id: number;
    chat_id: number;
    season_id: number;
    class_id?: number;
  }): Promise<PlayerProgress> {
    const result = await db.query(
      `INSERT INTO player_progress (user_id, chat_id, season_id, class_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.user_id, data.chat_id, data.season_id, data.class_id]
    );
    return result.rows[0];
  }

  static async findOrCreate(
    userId: number,
    chatId: number,
    seasonId: number
  ): Promise<PlayerProgress> {
    let progress = await this.find(userId, chatId, seasonId);
    if (!progress) {
      progress = await this.create({ user_id: userId, chat_id: chatId, season_id: seasonId });
    }
    return progress;
  }

  static async updateHp(id: number, hp: number): Promise<void> {
    await db.query(
      'UPDATE player_progress SET hp = $1, updated_at = NOW() WHERE id = $2',
      [hp, id]
    );
  }

  static async updateFloor(id: number, floor: number): Promise<void> {
    await db.query(
      'UPDATE player_progress SET floor = $1, updated_at = NOW() WHERE id = $2',
      [floor, id]
    );
  }

  static async updateCheckpoint(id: number, checkpointFloor: number): Promise<void> {
    await db.query(
      'UPDATE player_progress SET checkpoint_floor = $1, updated_at = NOW() WHERE id = $2',
      [checkpointFloor, id]
    );
  }

  static async setCurrentEnemy(id: number, enemyId: number | null): Promise<void> {
    await db.query(
      'UPDATE player_progress SET current_enemy_id = $1, updated_at = NOW() WHERE id = $2',
      [enemyId, id]
    );
  }

  static async updateStats(id: number, stats: {
    hp?: number;
    max_hp?: number;
    attack?: number;
    defense?: number;
  }): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (stats.hp !== undefined) {
      updates.push(`hp = $${paramIndex++}`);
      values.push(stats.hp);
    }
    if (stats.max_hp !== undefined) {
      updates.push(`max_hp = $${paramIndex++}`);
      values.push(stats.max_hp);
    }
    if (stats.attack !== undefined) {
      updates.push(`attack = $${paramIndex++}`);
      values.push(stats.attack);
    }
    if (stats.defense !== undefined) {
      updates.push(`defense = $${paramIndex++}`);
      values.push(stats.defense);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      values.push(id);
      
      await db.query(
        `UPDATE player_progress SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }
  }
}
