import { db } from '../database/db';

export interface Achievement {
  id: number;
  code: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  requirement_type: string;
  requirement_value: number;
  reward_gold: number;
  reward_title?: string;
  is_secret: boolean;
}

export interface PlayerAchievement {
  id: number;
  player_progress_id: number;
  achievement_id: number;
  unlocked_at: Date;
  progress: number;
}

export class AchievementService {
  
  async checkAndUnlockAchievements(
    playerProgressId: number,
    event: {
      type: 'floor_reached' | 'boss_killed' | 'level_reached' | 'gold_total' | 'item_obtained' | 'death' | 'battle';
      value: number;
      metadata?: any;
    }
  ): Promise<Achievement[]> {
    const unlockedAchievements: Achievement[] = [];

    // Get relevant achievements
    const achievements = await db.query(
      `SELECT * FROM achievements 
       WHERE requirement_type = $1 AND requirement_value <= $2`,
      [event.type, event.value]
    );

    for (const achievement of achievements.rows) {
      // Check if already unlocked
      const existing = await db.query(
        `SELECT * FROM player_achievements 
         WHERE player_progress_id = $1 AND achievement_id = $2`,
        [playerProgressId, achievement.id]
      );

      if (existing.rows.length === 0) {
        // Unlock achievement
        await this.unlockAchievement(playerProgressId, achievement.id);
        
        // Grant rewards
        if (achievement.reward_gold > 0) {
          await db.query(
            'UPDATE player_progress SET gold = gold + $1 WHERE id = $2',
            [achievement.reward_gold, playerProgressId]
          );
        }

        unlockedAchievements.push(achievement);
      }
    }

    return unlockedAchievements;
  }

  private async unlockAchievement(playerProgressId: number, achievementId: number): Promise<void> {
    await db.query(
      `INSERT INTO player_achievements (player_progress_id, achievement_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [playerProgressId, achievementId]
    );
  }

  async getPlayerAchievements(playerProgressId: number): Promise<any[]> {
    const result = await db.query(
      `SELECT a.*, pa.unlocked_at, pa.progress
       FROM achievements a
       LEFT JOIN player_achievements pa ON a.id = pa.achievement_id AND pa.player_progress_id = $1
       ORDER BY a.category, a.requirement_value`,
      [playerProgressId]
    );

    return result.rows;
  }

  async getUnlockedCount(playerProgressId: number): Promise<{ unlocked: number; total: number }> {
    const total = await db.query('SELECT COUNT(*) FROM achievements WHERE is_secret = false');
    const unlocked = await db.query(
      'SELECT COUNT(*) FROM player_achievements WHERE player_progress_id = $1',
      [playerProgressId]
    );

    return {
      unlocked: parseInt(unlocked.rows[0].count),
      total: parseInt(total.rows[0].count),
    };
  }

  generateAchievementMessage(achievement: Achievement): string {
    let msg = `🏆 **ДОСТИЖЕНИЕ ПОЛУЧЕНО!**\n\n`;
    msg += `${achievement.icon} **${achievement.name}**\n`;
    msg += `${achievement.description}\n\n`;
    
    if (achievement.reward_gold > 0) {
      msg += `💰 Награда: +${achievement.reward_gold} золота\n`;
    }
    
    if (achievement.reward_title) {
      msg += `👑 Титул: "${achievement.reward_title}"\n`;
    }

    return msg;
  }

  formatAchievementsList(achievements: any[]): string {
    let msg = `🏆 **Достижения**\n\n`;

    const categories: Record<string, string> = {
      progress: '📈 Прогресс',
      combat: '⚔️ Боевые',
      economy: '💰 Экономика',
      items: '📦 Предметы',
      special: '⭐ Особые',
    };

    let currentCategory = '';

    for (const ach of achievements) {
      if (ach.category !== currentCategory) {
        currentCategory = ach.category;
        msg += `\n**${categories[currentCategory] || currentCategory}:**\n`;
      }

      if (ach.unlocked_at) {
        msg += `✅ ${ach.icon} ${ach.name}\n`;
      } else if (ach.is_secret) {
        msg += `🔒 ??? Секретное достижение\n`;
      } else {
        msg += `⬜ ${ach.icon} ${ach.name} - ${ach.description}\n`;
      }
    }

    return msg;
  }

  async updateProgress(
    playerProgressId: number,
    achievementCode: string,
    progress: number
  ): Promise<void> {
    const achievement = await db.query(
      'SELECT id FROM achievements WHERE code = $1',
      [achievementCode]
    );

    if (achievement.rows.length === 0) return;

    await db.query(
      `INSERT INTO player_achievements (player_progress_id, achievement_id, progress)
       VALUES ($1, $2, $3)
       ON CONFLICT (player_progress_id, achievement_id) 
       DO UPDATE SET progress = $3`,
      [playerProgressId, achievement.rows[0].id, progress]
    );
  }
}

export const achievementService = new AchievementService();
