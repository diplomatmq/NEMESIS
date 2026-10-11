import { db } from '../database/db';
import { PlayerProgressModel } from '../database/models/PlayerProgress';
import { SeasonModel } from '../database/models/Season';
import { UserModel } from '../database/models/User';

interface SlotSession {
  id: number;
  telegram_user_id: number;
  spins_paid: number;
  spins_remaining: number;
  stars_paid: number;
  created_at: Date;
  expires_at: Date;
  status: 'active' | 'completed' | 'expired';
}

export class SlotMachineService {
  private readonly STARS_PER_SPIN = 2;
  private readonly SESSION_DURATION_MINUTES = 30;
  private readonly JACKPOT_VALUE = 64; // 777 in slot machine terms

  async createSession(telegramUserId: number, spins: number): Promise<{ sessionId: number; starsRequired: number }> {
    const starsRequired = spins * this.STARS_PER_SPIN;

    // Clean up expired sessions
    await this.cleanupExpiredSessions();

    // Check for existing active session
    const existing = await this.getActiveSession(telegramUserId);
    if (existing) {
      throw new Error(`У вас уже есть активная сессия!\n\n⏳ Осталось попыток: ${existing.spins_remaining}\n\nДождитесь окончания текущей сессии или используйте оставшиеся попытки.`);
    }

    const expiresAt = new Date(Date.now() + this.SESSION_DURATION_MINUTES * 60 * 1000);

    const result = await db.query(
      `INSERT INTO slot_sessions (telegram_user_id, spins_paid, spins_remaining, stars_paid, expires_at)
       VALUES ($1, $2, $2, $3, $4)
       RETURNING id`,
      [telegramUserId, spins, starsRequired, expiresAt]
    );

    return {
      sessionId: result.rows[0].id,
      starsRequired,
    };
  }

  async getActiveSession(telegramUserId: number): Promise<SlotSession | null> {
    const result = await db.query(
      `SELECT * FROM slot_sessions 
       WHERE telegram_user_id = $1 
         AND status = 'active' 
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [telegramUserId]
    );
    return result.rows[0] || null;
  }

  async processDice(telegramUserId: number, diceValue: number): Promise<{
    success: boolean;
    message: string;
    isJackpot: boolean;
    item?: {
      id: number;
      name: string;
      rarity: string;
      slot: string;
    };
  }> {
    const session = await this.getActiveSession(telegramUserId);
    
    if (!session) {
      return {
        success: false,
        message: '❌ У вас нет активной сессии лотов!\n\nИспользуйте /status → 🎰 Лоты в личных сообщениях.',
        isJackpot: false,
      };
    }

    if (session.spins_remaining <= 0) {
      await this.completeSession(session.id);
      return {
        success: false,
        message: '⚠️ У вас закончились попытки!\n\nХотите ещё? Используйте /status → 🎰 Лоты',
        isJackpot: false,
      };
    }

    // Decrement spins
    const newRemaining = session.spins_remaining - 1;
    await db.query(
      'UPDATE slot_sessions SET spins_remaining = $1 WHERE id = $2',
      [newRemaining, session.id]
    );

    // Check for jackpot (777)
    const isJackpot = diceValue === this.JACKPOT_VALUE;

    if (isJackpot) {
      // Give random item
      const item = await this.giveRandomItem(telegramUserId);
      
      if (newRemaining === 0) {
        await this.completeSession(session.id);
      }

      return {
        success: true,
        message: `🎰 **ДЖЕКПОТ!** 🎰\n\n` +
          `🎲 Выпало: **777** (${diceValue})\n` +
          `🎁 Вы получили: **${item.name}**\n` +
          `✨ Редкость: ${this.getRarityEmoji(item.rarity)} ${item.rarity}\n\n` +
          `⏳ Осталось попыток: **${newRemaining}**`,
        isJackpot: true,
        item,
      };
    } else {
      if (newRemaining === 0) {
        await this.completeSession(session.id);
      }

      return {
        success: true,
        message: `🎲 Выпало: **${diceValue}**\n\n` +
          `❌ Не повезло! Попробуйте ещё.\n` +
          `⏳ Осталось попыток: **${newRemaining}**`,
        isJackpot: false,
      };
    }
  }

  async penalizeForwarded(telegramUserId: number): Promise<string> {
    const session = await this.getActiveSession(telegramUserId);
    
    if (!session) {
      return '⚠️ Попытка обмануть систему замечена!\n\nУ вас нет активной сессии, но это не значит что мы не видим что вы делаете. 👀';
    }

    // Remove 2 spins as penalty
    const newRemaining = Math.max(0, session.spins_remaining - 2);
    await db.query(
      'UPDATE slot_sessions SET spins_remaining = $1 WHERE id = $2',
      [newRemaining, session.id]
    );

    if (newRemaining === 0) {
      await this.completeSession(session.id);
    }

    return `🚫 **ПОПЫТКА ОБМАНА ОБНАРУЖЕНА!**\n\n` +
      `❌ За пересылку сообщений снято **2 попытки**\n` +
      `⏳ Осталось попыток: **${newRemaining}**\n\n` +
      `⚠️ Следующая попытка обмана приведёт к более серьёзным последствиям!`;
  }

  private async giveRandomItem(telegramUserId: number): Promise<{
    id: number;
    name: string;
    rarity: string;
    slot: string;
  }> {
    // Get user and season
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) {
      throw new Error('User not found');
    }

    const season = await SeasonModel.getOrCreateCurrentSeason();
    const progress = await PlayerProgressModel.findOrCreate(user.id, season.id);

    // Roll for item rarity with custom chances
    const roll = Math.random();
    let rarity: string;

    if (roll < 0.00001) {
      rarity = 'mythic'; // 0.001%
    } else if (roll < 0.001) {
      rarity = 'legendary'; // 0.1%
    } else if (roll < 0.05) {
      rarity = 'epic'; // 5%
    } else if (roll < 0.2) {
      rarity = 'rare'; // 15%
    } else if (roll < 0.55) {
      rarity = 'uncommon'; // 35%
    } else {
      rarity = 'common'; // 44.99%
    }

    // Get random item of that rarity
    const itemResult = await db.query(
      `SELECT id, name, rarity, slot 
       FROM items 
       WHERE rarity = $1 AND season_id = $2
       ORDER BY RANDOM()
       LIMIT 1`,
      [rarity, season.id]
    );

    if (itemResult.rows.length === 0) {
      // Fallback to any item if rarity not found
      const fallbackResult = await db.query(
        `SELECT id, name, rarity, slot 
         FROM items 
         WHERE season_id = $1
         ORDER BY RANDOM()
         LIMIT 1`,
        [season.id]
      );
      if (fallbackResult.rows.length === 0) {
        throw new Error('No items available');
      }
      const item = fallbackResult.rows[0];
      await this.addItemToInventory(progress.id, item.id);
      return item;
    }

    const item = itemResult.rows[0];
    await this.addItemToInventory(progress.id, item.id);
    return item;
  }

  private async addItemToInventory(playerProgressId: number, itemId: number): Promise<void> {
    await db.query(
      `INSERT INTO inventory (player_progress_id, item_id, quantity)
       VALUES ($1, $2, 1)
       ON CONFLICT (player_progress_id, item_id) 
       DO UPDATE SET quantity = inventory.quantity + 1`,
      [playerProgressId, itemId]
    );
  }

  private getRarityEmoji(rarity: string): string {
    const emojis: Record<string, string> = {
      common: '⚪',
      uncommon: '🟢',
      rare: '🔵',
      epic: '🟣',
      legendary: '🟠',
      mythic: '🔴',
    };
    return emojis[rarity] || '⚪';
  }

  private async completeSession(sessionId: number): Promise<void> {
    await db.query(
      'UPDATE slot_sessions SET status = $1 WHERE id = $2',
      ['completed', sessionId]
    );
  }

  private async cleanupExpiredSessions(): Promise<void> {
    await db.query(
      `UPDATE slot_sessions 
       SET status = 'expired' 
       WHERE status = 'active' AND expires_at < NOW()`
    );
  }

  async confirmPayment(telegramUserId: number, sessionId: number): Promise<boolean> {
    const result = await db.query(
      `SELECT id FROM slot_sessions 
       WHERE id = $1 AND telegram_user_id = $2 AND status = 'active'`,
      [sessionId, telegramUserId]
    );
    return result.rows.length > 0;
  }
}

export const slotMachineService = new SlotMachineService();
