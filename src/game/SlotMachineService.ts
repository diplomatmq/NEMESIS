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
  is_paid: boolean;
}

export class SlotMachineService {
  private readonly STARS_PER_SPIN = 2;
  private readonly SESSION_DURATION_MINUTES = 30;
  private readonly JACKPOT_VALUE = 64; // 777 in slot machine terms
  private readonly TRIPLE_VALUES = new Set([1, 22, 43]); // BAR, grapes, lemon

  /** Rarity table for the 777 jackpot. */
  private readonly JACKPOT_RARITY_CHANCES: Array<{ rarity: string; chance: number }> = [
    { rarity: 'mythic', chance: 0.0001 },    // 0.01%
    { rarity: 'legendary', chance: 0.01 },   // 1%
    { rarity: 'epic', chance: 0.10 },        // 10%
    { rarity: 'rare', chance: 0.22 },        // 22%
    { rarity: 'uncommon', chance: 0.32 },    // 32%
    { rarity: 'common', chance: 0.3499 },    // 34.99%
  ];

  /** Rarity table for triple combos; intentionally lower than the jackpot. */
  private readonly TRIPLE_RARITY_CHANCES: Array<{ rarity: string; chance: number }> = [
    { rarity: 'legendary', chance: 0.003 },  // 0.3%
    { rarity: 'epic', chance: 0.06 },        // 6%
    { rarity: 'rare', chance: 0.16 },        // 16%
    { rarity: 'uncommon', chance: 0.30 },    // 30%
    { rarity: 'common', chance: 0.477 },     // 47.7%
  ];

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
      `INSERT INTO slot_sessions (telegram_user_id, spins_paid, spins_remaining, stars_paid, expires_at, is_paid)
       VALUES ($1, $2, $2, $3, $4, FALSE)
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
         AND is_paid = TRUE
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
    isTriple?: boolean;
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

    // Check for jackpot (777) or a triple combo (BAR / grapes / lemon)
    const isJackpot = diceValue === this.JACKPOT_VALUE;
    const isTriple = !isJackpot && this.TRIPLE_VALUES.has(diceValue);
    const newRemaining = session.spins_remaining - 1;

    if (isJackpot || isTriple) {
      // Triple combos drop items too, but with a lower rarity table than the jackpot.
      // Grant the item before consuming the spin so a failed drop never costs a try.
      const item = await this.giveRandomItem(
        telegramUserId,
        isJackpot ? this.JACKPOT_RARITY_CHANCES : this.TRIPLE_RARITY_CHANCES
      );

      await db.query(
        'UPDATE slot_sessions SET spins_remaining = $1 WHERE id = $2',
        [newRemaining, session.id]
      );

      if (newRemaining === 0) {
        await this.completeSession(session.id);
      }

      const combo = isJackpot ? '777' : this.getTripleLabel(diceValue);
      const header = isJackpot ? '🎰 **ДЖЕКПОТ!** 🎰' : '🎰 **ТРИ В РЯД!** 🎰';

      return {
        success: true,
        message: `${header}\n\n` +
          `🎲 Выпало: **${combo}** (${diceValue})\n` +
          `🎁 Вы получили: **${item.name}**\n` +
          `✨ Редкость: ${this.getRarityEmoji(item.rarity)} ${item.rarity}\n\n` +
          `⏳ Осталось попыток: **${newRemaining}**`,
        isJackpot,
        isTriple,
        item,
      };
    } else {
      await db.query(
        'UPDATE slot_sessions SET spins_remaining = $1 WHERE id = $2',
        [newRemaining, session.id]
      );

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

  /** Grants a player a number of random items (used for compensation). */
  async grantRandomItems(telegramUserId: number, count: number): Promise<Array<{
    id: number;
    name: string;
    rarity: string;
    slot: string;
  }>> {
    const granted: Array<{ id: number; name: string; rarity: string; slot: string }> = [];
    for (let i = 0; i < count; i++) {
      granted.push(await this.giveRandomItem(telegramUserId, this.JACKPOT_RARITY_CHANCES));
    }
    return granted;
  }

  private async giveRandomItem(
    telegramUserId: number,
    rarityChances: Array<{ rarity: string; chance: number }>
  ): Promise<{
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

    // Roll for item rarity using the table for this kind of win
    const roll = Math.random();
    let rarity = 'common';
    let cumulativeChance = 0;

    for (const { rarity: candidate, chance } of rarityChances) {
      cumulativeChance += chance;
      if (roll < cumulativeChance) {
        rarity = candidate;
        break;
      }
    }

    // Get random item of that rarity. Items are global (no season_id).
    const itemResult = await db.query(
      `SELECT id, name, rarity, slot 
       FROM items 
       WHERE rarity = $1 AND slot != 'potion'
       ORDER BY RANDOM()
       LIMIT 1`,
      [rarity]
    );

    if (itemResult.rows.length === 0) {
      // Fallback to any item if rarity not found
      const fallbackResult = await db.query(
        `SELECT id, name, rarity, slot 
         FROM items 
         WHERE slot != 'potion'
         ORDER BY RANDOM()
         LIMIT 1`
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
    const existing = await db.query(
      `SELECT id FROM player_inventory 
       WHERE player_progress_id = $1 AND item_id = $2`,
      [playerProgressId, itemId]
    );

    if (existing.rows.length > 0) {
      await db.query(
        `UPDATE player_inventory 
         SET quantity = quantity + 1 
         WHERE player_progress_id = $1 AND item_id = $2`,
        [playerProgressId, itemId]
      );
    } else {
      await db.query(
        `INSERT INTO player_inventory (player_progress_id, item_id, quantity)
         VALUES ($1, $2, 1)`,
        [playerProgressId, itemId]
      );
    }
  }

  private getTripleLabel(diceValue: number): string {
    switch (diceValue) {
      case 1: return 'BAR BAR BAR';
      case 22: return '🍇🍇🍇';
      case 43: return '🍋🍋🍋';
      default: return `${diceValue}`;
    }
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
    // Mark session as paid
    const result = await db.query(
      `UPDATE slot_sessions 
       SET is_paid = TRUE 
       WHERE id = $1 AND telegram_user_id = $2 AND status = 'active' AND is_paid = FALSE
       RETURNING id`,
      [sessionId, telegramUserId]
    );
    return result.rows.length > 0;
  }
}

export const slotMachineService = new SlotMachineService();
