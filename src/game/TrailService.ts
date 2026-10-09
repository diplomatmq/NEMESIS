import { InlineKeyboard } from 'grammy';
import { db } from '../database/db';
import { lootService } from './LootService';
import { merchantService } from './MerchantService';

export type TrailOptionKind = 'combat' | 'market';

export interface TrailOption {
  label: string;
  kind: TrailOptionKind;
  modifier?: number;
}

interface TrailEvent {
  id: number;
  floor: number;
  options: TrailOption[];
}

export interface TrailResult {
  message: string;
  keyboard?: InlineKeyboard;
}

export class TrailService {
  async createEvent(
    userId: number,
    seasonId: number,
    chatId: number,
    floor: number
  ): Promise<TrailResult> {
    const options: TrailOption[] = [
      { label: '🟢 Тихая тропа', kind: 'combat', modifier: 0.85 },
      { label: '🔴 Опасная тропа', kind: 'combat', modifier: 1.2 },
      { label: '🛒 Рынок', kind: 'market' },
    ];

    const shuffled = options.sort(() => Math.random() - 0.5);
    const result = await db.query(
      `INSERT INTO trail_events (user_id, season_id, chat_id, floor, options)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, season_id) DO UPDATE
       SET chat_id = EXCLUDED.chat_id, floor = EXCLUDED.floor,
           options = EXCLUDED.options, created_at = NOW()
       RETURNING id`,
      [userId, seasonId, chatId, floor, JSON.stringify(shuffled)]
    );

    return {
      message:
        '\n🧭 **След найден!**\n' +
        'Выберите один из трёх путей. Внимание: отказаться от выбора нельзя — после нажатия путь будет пройден.\n',
      keyboard: this.createKeyboard(result.rows[0].id, shuffled),
    };
  }

  async getEvent(userId: number, seasonId: number): Promise<TrailEvent | null> {
    const result = await db.query(
      `SELECT id, floor, options FROM trail_events
       WHERE user_id = $1 AND season_id = $2`,
      [userId, seasonId]
    );
    return result.rows[0] || null;
  }

  async resolveEvent(
    userId: number,
    seasonId: number,
    progressId: number,
    eventId: number,
    optionIndex: number
  ): Promise<TrailResult> {
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 2) {
      return { message: 'Вариант следа не найден.' };
    }

    const result = await db.query(
      `DELETE FROM trail_events
       WHERE id = $1 AND user_id = $2 AND season_id = $3
       RETURNING id, floor, options`,
      [eventId, userId, seasonId]
    );
    const event = result.rows[0] as TrailEvent | undefined;
    if (!event) {
      return { message: 'Этот след уже выбран или устарел.' };
    }

    const option = event.options[optionIndex];
    if (!option) {
      return { message: 'Вариант следа не найден.' };
    }

    if (option.kind === 'combat') {
      await db.query(
        `UPDATE player_progress SET trail_modifier = $1, updated_at = NOW()
         WHERE id = $2`,
        [option.modifier || 1, progressId]
      );
      return {
        message:
          `${option.label} выбрана.\n` +
          'Следующий противник будет на этом же этаже, но его сила будет отличаться. Начинайте бой командой «атака» или «защита».',
      };
    }

    return this.createMarket(progressId, event.floor);
  }

  private async createMarket(progressId: number, floor: number): Promise<TrailResult> {
    const level = Math.floor(floor / 10) + 1;
    const offers = await db.query(
      `SELECT id, name, description, rarity
       FROM items
       WHERE level_required <= $1 AND slot != 'potion'
       ORDER BY RANDOM() LIMIT 3`,
      [level]
    );
    if (offers.rows.length === 0) {
      return { message: '🛒 Рынок пуст. След закончился, но вы ничего не потеряли.' };
    }

    const prices = offers.rows.map((item) => ({
      ...item,
      price: 25 + level * 15 + Math.floor(Math.random() * 30),
    }));
    const marketId = await this.saveMarket(progressId, prices);
    const keyboard = new InlineKeyboard();
    for (const [index, offer] of prices.entries()) {
      keyboard.text(
        `${index + 1}. ${offer.name} — ${offer.price}💰`,
        `trailmarket:${marketId}:${index}`
      );
      if (index < prices.length - 1) keyboard.row();
    }

    const text = prices
      .map((offer, index) => `${index + 1}. **${offer.name}** — ${offer.price} золота`)
      .join('\n');
    return {
      message:
        '🛒 **Обязательный рынок**\n\n' +
        `${text}\n\n` +
        'Выберите один вариант. При наличии золота покупка оплатится монетами; иначе один ваш предмет будет обменян на выбранный. Отказаться нельзя.',
      keyboard,
    };
  }

  async resolveMarket(
    userId: number,
    progressId: number,
    marketId: number,
    offerIndex: number
  ): Promise<string> {
    const result = await db.query(
      `DELETE FROM trail_markets WHERE id = $1 AND player_progress_id = $2
       RETURNING offers`,
      [marketId, progressId]
    );
    const offers = result.rows[0]?.offers;
    const offer = offers?.[offerIndex];
    if (!offer) return 'Этот рынок уже закрыт или вариант устарел.';

    const progress = await db.query(
      'SELECT gold FROM player_progress WHERE id = $1',
      [progressId]
    );
    const gold = Number(progress.rows[0]?.gold || 0);
    if (gold >= offer.price) {
      await db.query('UPDATE player_progress SET gold = gold - $1 WHERE id = $2', [
        offer.price,
        progressId,
      ]);
      await lootService.addItemToInventory(progressId, offer.id);
      return `✅ Вы купили **${offer.name}** за ${offer.price} золота. Отказаться от сделки было нельзя.`;
    }

    const owned = await db.query(
      `SELECT item_id FROM player_inventory
       WHERE player_progress_id = $1 ORDER BY quantity DESC, id LIMIT 1`,
      [progressId]
    );
    if (owned.rows[0]) {
      await merchantService.sellItem(progressId, owned.rows[0].item_id);
      await lootService.addItemToInventory(progressId, offer.id);
      return `🔁 Золота не хватило: ваш предмет был автоматически обменян на **${offer.name}**.`;
    }

    await lootService.addItemToInventory(progressId, offer.id);
    return `🎁 У вас не было ресурсов для оплаты, поэтому рынок отдал **${offer.name}** бесплатно.`;
  }

  private async saveMarket(progressId: number, offers: unknown[]): Promise<number> {
    const result = await db.query(
      `INSERT INTO trail_markets (player_progress_id, offers)
       VALUES ($1, $2) RETURNING id`,
      [progressId, JSON.stringify(offers)]
    );
    return result.rows[0].id;
  }

  private createKeyboard(id: number, options: TrailOption[]): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    options.forEach((option, index) => {
      keyboard.text(option.label, `trail:${id}:${index}`);
      if (index < options.length - 1) keyboard.row();
    });
    return keyboard;
  }
}

export const trailService = new TrailService();
