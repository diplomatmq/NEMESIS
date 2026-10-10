import { db } from '../database/db';
import { ActionType } from '../types/game.types';

export interface BehaviorProfile {
  id: number;
  user_id: number;
  chat_id: number;
  season_id: number;
  attack_count: number;
  defend_count: number;
  total_actions: number;
  attack_rate: number;
  defend_rate: number;
  aggression: number;
  predictability: number;
  recent_actions: ActionType[];
  after_big_damage?: string;
  common_sequences: string[];
  updated_at: Date;
}

export class BehaviorTracker {
  private readonly MAX_RECENT_ACTIONS = 10;

  async getOrCreateProfile(
    userId: number,
    chatId: number,
    seasonId: number
  ): Promise<BehaviorProfile> {
    const existing = await this.findProfile(userId, chatId, seasonId);
    if (existing) {
      return existing;
    }

    return await this.createProfile(userId, chatId, seasonId);
  }

  private async findProfile(
    userId: number,
    chatId: number,
    seasonId: number
  ): Promise<BehaviorProfile | null> {
    const result = await db.query(
      `SELECT * FROM behavior_profiles 
       WHERE user_id = $1 AND season_id = $2`,
      [userId, seasonId]
    );
    
    if (result.rows[0]) {
      const row = result.rows[0];
      return {
        ...row,
        recent_actions: row.recent_actions || [],
        common_sequences: row.common_sequences || [],
      };
    }
    
    return null;
  }

  private async createProfile(
    userId: number,
    chatId: number,
    seasonId: number
  ): Promise<BehaviorProfile> {
    // Use ON CONFLICT to handle race conditions in group chats
    const result = await db.query(
      `INSERT INTO behavior_profiles (user_id, chat_id, season_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, season_id) DO NOTHING
       RETURNING *`,
      [userId, chatId, seasonId]
    );
    
    // If conflict occurred (RETURNING is empty), fetch the existing profile
    if (result.rows.length === 0) {
      const existing = await this.findProfile(userId, chatId, seasonId);
      if (existing) {
        return existing;
      }
      throw new Error('Failed to create or find behavior profile');
    }
    
    return {
      ...result.rows[0],
      recent_actions: [],
      common_sequences: [],
    };
  }

  async recordAction(
    userId: number,
    chatId: number,
    seasonId: number,
    action: ActionType,
    receivedDamage?: number
  ): Promise<void> {
    const profile = await this.getOrCreateProfile(userId, chatId, seasonId);

    // Update action counts
    const attackCount = action === ActionType.ATTACK ? profile.attack_count + 1 : profile.attack_count;
    const defendCount = action === ActionType.DEFEND ? profile.defend_count + 1 : profile.defend_count;
    const totalActions = profile.total_actions + 1;

    // Calculate rates
    const attackRate = (attackCount / totalActions) * 100;
    const defendRate = (defendCount / totalActions) * 100;

    // Update recent actions
    const recentActions = [...profile.recent_actions, action].slice(-this.MAX_RECENT_ACTIONS);

    // Calculate aggression (более атакующий стиль = выше агрессия)
    const aggression = Math.min(100, attackRate + 10);

    // Calculate predictability (повторяющиеся паттерны = выше предсказуемость)
    const predictability = this.calculatePredictability(recentActions);

    // Detect behavior after big damage
    let afterBigDamage = profile.after_big_damage;
    if (receivedDamage && receivedDamage > 30) {
      afterBigDamage = action;
    }

    // Detect common sequences
    const commonSequences = this.detectCommonSequences(recentActions);

    await db.query(
      `UPDATE behavior_profiles 
       SET attack_count = $1,
           defend_count = $2,
           total_actions = $3,
           attack_rate = $4,
           defend_rate = $5,
           aggression = $6,
           predictability = $7,
           recent_actions = $8,
           after_big_damage = $9,
           common_sequences = $10,
           updated_at = NOW()
       WHERE user_id = $11 AND season_id = $12`,
      [
        attackCount,
        defendCount,
        totalActions,
        attackRate,
        defendRate,
        aggression,
        predictability,
        JSON.stringify(recentActions),
        afterBigDamage,
        JSON.stringify(commonSequences),
        userId,
        seasonId,
      ]
    );
  }

  private calculatePredictability(actions: ActionType[]): number {
    if (actions.length < 3) {
      return 50; // Недостаточно данных
    }

    // Проверяем повторяющиеся паттерны
    let patternCount = 0;
    
    // Проверка на однообразие (только атаки или только защита)
    const allSame = actions.every(a => a === actions[0]);
    if (allSame) {
      return 90;
    }

    // Проверка на чередование (A-D-A-D-A-D)
    let alternating = true;
    for (let i = 1; i < actions.length; i++) {
      if (actions[i] === actions[i - 1]) {
        alternating = false;
        break;
      }
    }
    if (alternating) {
      return 80;
    }

    // Подсчёт повторяющихся последовательностей длиной 2-3
    for (let len = 2; len <= 3; len++) {
      const sequences = new Map<string, number>();
      
      for (let i = 0; i <= actions.length - len; i++) {
        const sequence = actions.slice(i, i + len).join('-');
        sequences.set(sequence, (sequences.get(sequence) || 0) + 1);
      }

      for (const count of sequences.values()) {
        if (count > 1) {
          patternCount += count;
        }
      }
    }

    // Чем больше паттернов, тем выше предсказуемость
    const predictability = Math.min(100, 40 + (patternCount * 10));
    return predictability;
  }

  private detectCommonSequences(actions: ActionType[]): string[] {
    const sequences: string[] = [];
    
    if (actions.length < 2) {
      return sequences;
    }

    // Находим последовательности длиной 2-3
    for (let len = 2; len <= 3; len++) {
      const counts = new Map<string, number>();
      
      for (let i = 0; i <= actions.length - len; i++) {
        const sequence = actions.slice(i, i + len).join('-');
        counts.set(sequence, (counts.get(sequence) || 0) + 1);
      }

      // Добавляем часто встречающиеся последовательности
      for (const [seq, count] of counts.entries()) {
        if (count >= 2 && !sequences.includes(seq)) {
          sequences.push(seq);
        }
      }
    }

    return sequences.slice(0, 5); // Максимум 5 последовательностей
  }

  predictNextAction(profile: BehaviorProfile): ActionType {
    // Если недостаточно данных - случайное действие
    if (profile.total_actions < 3) {
      return Math.random() > 0.5 ? ActionType.ATTACK : ActionType.DEFEND;
    }

    // Если есть общая последовательность, пытаемся предсказать
    if (profile.common_sequences.length > 0) {
      const recentStr = profile.recent_actions.slice(-2).join('-');
      
      for (const seq of profile.common_sequences) {
        if (seq.startsWith(recentStr)) {
          const nextAction = seq.split('-').pop();
          if (nextAction === 'attack') return ActionType.ATTACK;
          if (nextAction === 'defend') return ActionType.DEFEND;
        }
      }
    }

    // Используем показатель агрессии
    if (profile.aggression > 70) {
      // Агрессивный игрок скорее всего атакует
      return Math.random() > 0.3 ? ActionType.ATTACK : ActionType.DEFEND;
    } else if (profile.aggression < 40) {
      // Защитный игрок скорее всего защищается
      return Math.random() > 0.3 ? ActionType.DEFEND : ActionType.ATTACK;
    }

    // Используем последнее действие
    const lastAction = profile.recent_actions[profile.recent_actions.length - 1];
    
    // Если предсказуемость высокая, предполагаем повтор
    if (profile.predictability > 70) {
      return lastAction;
    }

    // Если предсказуемость средняя, предполагаем чередование
    if (profile.predictability > 40) {
      return lastAction === ActionType.ATTACK ? ActionType.DEFEND : ActionType.ATTACK;
    }

    // Иначе случайное
    return Math.random() > 0.5 ? ActionType.ATTACK : ActionType.DEFEND;
  }

  calculateAIAccuracy(floor: number, aiResist: number = 0): number {
    // Базовая точность AI растёт с этажами
    let baseAccuracy: number;

    if (floor <= 10) {
      baseAccuracy = 0.2; // 20%
    } else if (floor <= 30) {
      baseAccuracy = 0.5; // 50%
    } else if (floor <= 60) {
      baseAccuracy = 0.7; // 70%
    } else if (floor <= 100) {
      baseAccuracy = 0.8; // 80%
    } else {
      baseAccuracy = 0.9; // 90%
    }

    // AI resist снижает точность
    const finalAccuracy = Math.max(0.1, baseAccuracy - (aiResist / 100));

    return finalAccuracy;
  }
}

export const behaviorTracker = new BehaviorTracker();
