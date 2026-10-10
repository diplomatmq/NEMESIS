import { db } from '../db';

export interface PlayerProgress {
  id: number;
  user_id: number;
  season_id: number;
  class_id?: number;
  floor: number;
  hp: number;
  max_hp: number;
  attack: number;
  defense: number;
  crit_chance: number;
  dodge: number;
  lifesteal: number;
  ai_resist: number;
  gold: number;
  xp: number;
  level: number;
  checkpoint_floor: number;
  trail_modifier: number;
  necro_mob_souls: number;
  necro_boss_souls: Array<{ name: string; floor: number; boss_config?: unknown }>;
  necro_pending_soul?: { name: string; floor: number; boss_config?: unknown } | null;
  necro_sacrifice_available_at?: Date;
  necro_debuff_games: number;
  necro_attack_bonus: number;
  necro_defense_bonus: number;
  necro_bonus_games: number;
  necro_summon_effect?: { type: 'mobs' | 'boss'; name?: string; ability?: string } | null;
  created_at: Date;
  updated_at: Date;
}

export interface ChatProgress {
  id: number;
  user_id: number;
  chat_id: number;
  season_id: number;
  current_floor: number;
  highest_floor_reached: number;
  is_primary_chat: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CombatState {
  id: number;
  user_id: number;
  season_id: number;
  floor: number;
  enemy_data: any; // JSON data for enemy
  player_hp_before: number;
  rounds_completed: number;
  created_at: Date;
  updated_at: Date;
}

export class PlayerProgressModel {
  static async find(userId: number, seasonId: number): Promise<PlayerProgress | null> {
    const result = await db.query(
      'SELECT * FROM player_progress WHERE user_id = $1 AND season_id = $2',
      [userId, seasonId]
    );
    return result.rows[0] || null;
  }

  static async create(data: {
    user_id: number;
    season_id: number;
    class_id?: number;
  }): Promise<PlayerProgress> {
    const result = await db.query(
      `INSERT INTO player_progress (user_id, season_id, class_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, season_id) DO NOTHING
       RETURNING *`,
      [data.user_id, data.season_id, data.class_id]
    );
    
    // If conflict occurred, fetch the existing record
    if (result.rows.length === 0) {
      const existing = await this.find(data.user_id, data.season_id);
      if (existing) {
        return existing;
      }
      throw new Error('Failed to create or find player progress');
    }
    
    return result.rows[0];
  }

  static async findOrCreate(
    userId: number,
    seasonId: number
  ): Promise<PlayerProgress> {
    let progress = await this.find(userId, seasonId);
    if (!progress) {
      progress = await this.create({ user_id: userId, season_id: seasonId });
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


// Chat Progress Model
export class ChatProgressModel {
  static async find(userId: number, chatId: number, seasonId: number): Promise<ChatProgress | null> {
    const result = await db.query(
      'SELECT * FROM chat_progress WHERE user_id = $1 AND chat_id = $2 AND season_id = $3',
      [userId, chatId, seasonId]
    );
    return result.rows[0] || null;
  }

  static async findOrCreate(userId: number, chatId: number, seasonId: number): Promise<ChatProgress> {
    let chatProgress = await this.find(userId, chatId, seasonId);
    if (!chatProgress) {
      // Check if this is the first chat for this user/season
      const existingChats = await db.query(
        'SELECT COUNT(*) as count FROM chat_progress WHERE user_id = $1 AND season_id = $2',
        [userId, seasonId]
      );
      const isPrimary = existingChats.rows[0].count === 0;

      const result = await db.query(
        `INSERT INTO chat_progress (user_id, chat_id, season_id, is_primary_chat)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, chat_id, season_id) DO NOTHING
         RETURNING *`,
        [userId, chatId, seasonId, isPrimary]
      );
      
      // If conflict occurred, fetch the existing record
      if (result.rows.length === 0) {
        chatProgress = await this.find(userId, chatId, seasonId);
      } else {
        chatProgress = result.rows[0];
      }
    }

    if (!chatProgress) {
      throw new Error(`Failed to create chat progress for user ${userId}, chat ${chatId}, season ${seasonId}`);
    }

    // Repair records created before chat identity tracking was fixed. A user
    // with only one chat must never see it as an additional chat.
    if (!chatProgress.is_primary_chat) {
      const otherChats = await db.query(
        `SELECT COUNT(*) AS count
         FROM chat_progress
         WHERE user_id = $1 AND season_id = $2 AND id <> $3`,
        [userId, seasonId, chatProgress.id]
      );
      if (Number(otherChats.rows[0].count) === 0) {
        const result = await db.query(
          `UPDATE chat_progress
           SET is_primary_chat = true, updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [chatProgress.id]
        );
        chatProgress = result.rows[0];
      }
    }

    return chatProgress!;
  }

  static async updateFloor(id: number, floor: number): Promise<void> {
    await db.query(
      `UPDATE chat_progress 
       SET current_floor = $1, 
           highest_floor_reached = GREATEST(highest_floor_reached, $1),
           updated_at = NOW() 
       WHERE id = $2`,
      [floor, id]
    );
  }

  static async isPrimaryChat(userId: number, chatId: number, seasonId: number): Promise<boolean> {
    const chatProgress = await this.find(userId, chatId, seasonId);
    return chatProgress?.is_primary_chat || false;
  }
}

// Combat State Model
export class CombatStateModel {
  static async find(userId: number, seasonId: number): Promise<CombatState | null> {
    const result = await db.query(
      'SELECT * FROM combat_state WHERE user_id = $1 AND season_id = $2',
      [userId, seasonId]
    );
    return result.rows[0] || null;
  }

  static async create(data: {
    user_id: number;
    season_id: number;
    floor: number;
    enemy_data: any;
    player_hp_before: number;
  }): Promise<CombatState> {
    const result = await db.query(
      `INSERT INTO combat_state (user_id, season_id, floor, enemy_data, player_hp_before)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.user_id, data.season_id, data.floor, JSON.stringify(data.enemy_data), data.player_hp_before]
    );
    return result.rows[0];
  }

  static async update(id: number, data: {
    enemy_data?: any;
    rounds_completed?: number;
  }): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.enemy_data !== undefined) {
      updates.push(`enemy_data = $${paramIndex++}`);
      values.push(JSON.stringify(data.enemy_data));
    }
    if (data.rounds_completed !== undefined) {
      updates.push(`rounds_completed = $${paramIndex++}`);
      values.push(data.rounds_completed);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      values.push(id);
      
      await db.query(
        `UPDATE combat_state SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }
  }

  static async delete(userId: number, seasonId: number): Promise<void> {
    await db.query(
      'DELETE FROM combat_state WHERE user_id = $1 AND season_id = $2',
      [userId, seasonId]
    );
  }

  static async findOrCreate(
    userId: number,
    seasonId: number,
    floor: number,
    enemyData: any,
    playerHpBefore: number
  ): Promise<CombatState> {
    let state = await this.find(userId, seasonId);
    if (!state) {
      state = await this.create({
        user_id: userId,
        season_id: seasonId,
        floor,
        enemy_data: enemyData,
        player_hp_before: playerHpBefore
      });
    }
    return state;
  }
}
