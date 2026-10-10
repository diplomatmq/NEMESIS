import { db } from '../database/db';
import { config } from '../config';

const COOLDOWN_EXEMPT_TELEGRAM_IDS = new Set<number>([
  793216884, //некромант
  678418106, //шут
  1391860862, //ассасин
  8687764486, //берсерк
  6335911487, //страж    еще есть арканист,тактик
  6758055954, //вампир
  
]);

export function isCooldownExemptTelegramUser(telegramUserId: number): boolean {
  return COOLDOWN_EXEMPT_TELEGRAM_IDS.has(telegramUserId);
}

export interface CooldownInfo {
  isActive: boolean;
  remainingSeconds?: number;
  availableAt?: Date;
}

export class CooldownService {
  private cooldownMinutes: number;

  constructor() {
    this.cooldownMinutes = config.game.cooldownMinutes;
  }

  async check(userId: number, chatId: number, actionType: string = 'combat'): Promise<CooldownInfo> {
    const result = await db.query(
      `SELECT available_at FROM cooldowns 
       WHERE user_id = $1 AND action_type = $2`,
      [userId, actionType]
    );

    if (result.rows.length === 0) {
      return { isActive: false };
    }

    const availableAt = new Date(result.rows[0].available_at);
    const now = new Date();

    if (now >= availableAt) {
      return { isActive: false };
    }

    const remainingSeconds = Math.ceil((availableAt.getTime() - now.getTime()) / 1000);

    return {
      isActive: true,
      remainingSeconds,
      availableAt,
    };
  }

  async set(userId: number, chatId: number, actionType: string = 'combat'): Promise<Date> {
    const availableAt = new Date(Date.now() + this.cooldownMinutes * 60 * 1000);

    await db.query(
      `INSERT INTO cooldowns (user_id, chat_id, action_type, available_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, action_type)
       DO UPDATE SET available_at = EXCLUDED.available_at`,
      [userId, chatId, actionType, availableAt]
    );

    return availableAt;
  }

  async clear(userId: number, chatId: number, actionType: string = 'combat'): Promise<void> {
    await db.query(
      'DELETE FROM cooldowns WHERE user_id = $1 AND action_type = $2',
      [userId, actionType]
    );
  }

  formatRemainingTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    
    if (minutes > 0) {
      return `${minutes} мин ${secs} сек`;
    }
    return `${secs} сек`;
  }
}

export const cooldownService = new CooldownService();
