import { db } from '../database/db';
import { InlineKeyboard } from 'grammy';
import { lootService, Item } from './LootService';
import { merchantService } from './MerchantService';
import { SeededRandom } from './SeededRandom';
import { CUSTOM_EMOJI, ce } from './CustomEmoji';

export interface MarketItem {
  item: Item;
  price: number;
  discount?: number;
}

export class DailyMarketService {

  private static readonly RARITY_WEIGHTS = [
    { rarity: 'common', weight: 45 },
    { rarity: 'uncommon', weight: 25 },
    { rarity: 'rare', weight: 18 },
    { rarity: 'epic', weight: 8 },
    { rarity: 'legendary', weight: 3 },
    { rarity: 'mythic', weight: 1 },
  ];

  private static readonly FLAT_PRICES: Record<string, number> = {
    common: 100,
    uncommon: 200,
    rare: 400,
    epic: 800,
  };

  private static readonly PRICE_RANGES: Record<string, { min: number; max: number }> = {
    legendary: { min: 3000, max: 16000 },
    mythic: { min: 13000, max: 45000 },
  };
  
  /**
   * Get or generate today's market items
   */
  async getTodayMarket(): Promise<MarketItem[]> {
    const today = this.todayKey();
    const row = await this.getTodayMarketRow(today);

    if (row) {
      return this.parseMarketItems(row.items_json);
    }

    return await this.generateTodayMarket(today);
  }

  /**
   * The free daily reroll is available until it has been used once.
   */
  async canRerollToday(): Promise<boolean> {
    const row = await this.getTodayMarketRow(this.todayKey());
    return !row || !row.rerolled;
  }

  /**
   * Consume today's single free reroll and replace the market with new items.
   */
  async rerollTodayMarket(): Promise<MarketItem[]> {
    const today = this.todayKey();
    const row = await this.getTodayMarketRow(today);

    if (row?.rerolled) {
      throw new Error('Бесплатная смена маркета уже использована сегодня.');
    }

    const seed = this.dateSeed(today) + 1;
    const items = await this.rollMarketItems(seed);

    if (row) {
      await this.updateMarketRow(row.id, items, seed, true);
    } else {
      await this.insertMarketRow(today, items, seed, true);
    }

    return items;
  }

  private todayKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  private async getTodayMarketRow(
    date: string
  ): Promise<{ id: number; items_json: any; rerolled: boolean } | null> {
    const result = await db.query(
      'SELECT id, items_json, rerolled FROM daily_market WHERE market_date = $1',
      [date]
    );
    return result.rows[0] ?? null;
  }
  
  /**
   * Generate market for today with seeded randomness
   */
  private async generateTodayMarket(date: string): Promise<MarketItem[]> {
    const seed = this.dateSeed(date);
    const items = await this.rollMarketItems(seed);
    await this.insertMarketRow(date, items, seed, false);
    return items;
  }

  private async insertMarketRow(
    date: string,
    items: MarketItem[],
    seed: number,
    rerolled: boolean
  ): Promise<void> {
    const itemsJson = this.serializeItems(items);
    await db.query(
      'INSERT INTO daily_market (market_date, items_json, seed, rerolled) VALUES ($1, $2, $3, $4)',
      [date, JSON.stringify(itemsJson), seed, rerolled]
    );
  }

  private async updateMarketRow(
    id: number,
    items: MarketItem[],
    seed: number,
    rerolled: boolean
  ): Promise<void> {
    const itemsJson = this.serializeItems(items);
    await db.query(
      'UPDATE daily_market SET items_json = $1, seed = $2, rerolled = $3 WHERE id = $4',
      [JSON.stringify(itemsJson), seed, rerolled, id]
    );
  }

  private serializeItems(items: MarketItem[]): Array<{ item_id: number; price: number; discount?: number }> {
    return items.map(mi => ({
      item_id: mi.item.id,
      price: mi.price,
      discount: mi.discount,
    }));
  }

  private async rollMarketItems(seed: number): Promise<MarketItem[]> {
    const rng = new SeededRandom(seed);
    const items: MarketItem[] = [];
    const itemCount = 10;

    for (let i = 0; i < itemCount; i++) {
      const rarity = this.selectRarity(rng);
      const item = await this.getRandomItemByRarity(rarity, rng);
      
      if (item) {
        const basePrice = await this.calculatePrice(item);
        const hasDiscount = rng.next() < 0.25; // 25% chance for discount
        const discount = hasDiscount ? 10 + Math.floor(rng.next() * 21) : 0; // 10-30% discount
        
        items.push({
          item,
          price: Math.floor(basePrice * (1 - discount / 100)),
          discount: discount > 0 ? discount : undefined,
        });
      }
    }

    return items;
  }
  
  /**
   * Select rarity for a single market slot
   */
  private selectRarity(rng: SeededRandom): string {
    const roll = rng.next() * 100;
    let cumulative = 0;
    for (const { rarity, weight } of DailyMarketService.RARITY_WEIGHTS) {
      cumulative += weight;
      if (roll < cumulative) return rarity;
    }
    return 'common';
  }
  
  /**
   * Get random item by rarity
   */
  private async getRandomItemByRarity(rarity: string, rng: SeededRandom): Promise<Item | null> {
    const result = await db.query(
      `SELECT * FROM items 
       WHERE rarity = $1
       ORDER BY id`, // Deterministic ordering
      [rarity]
    );
    
    if (result.rows.length === 0) return null;
    
    // Use seeded random to select item
    const index = Math.floor(rng.next() * result.rows.length);
    return result.rows[index];
  }
  
  /**
   * Calculate price for item. Common rarities use a flat price; legendary and
   * mythic scale with the item's power inside a rarity-based range.
   */
  private async calculatePrice(item: Item): Promise<number> {
    const range = DailyMarketService.PRICE_RANGES[item.rarity];
    if (!range) {
      return DailyMarketService.FLAT_PRICES[item.rarity] ?? 100;
    }

    const result = await db.query('SELECT * FROM items WHERE rarity = $1', [item.rarity]);
    const powers: number[] = result.rows.map((row: Item) => this.calculateItemPower(row));
    const min = Math.min(...powers);
    const max = Math.max(...powers);

    if (!Number.isFinite(min) || max <= min) {
      return range.max;
    }

    const ratio = (this.calculateItemPower(item) - min) / (max - min);
    return Math.round(range.min + ratio * (range.max - range.min));
  }

  /**
   * Relative power of an item, using the same weights as the balance simulator.
   */
  private calculateItemPower(item: Item): number {
    return (
      item.hp_bonus * 0.2 +
      item.attack_bonus * 1.5 +
      item.defense_bonus * 1.5 +
      item.crit_chance_bonus * 3 +
      item.dodge_bonus * 2 +
      item.lifesteal_bonus * 1 +
      item.ai_resist_bonus * 0.5
    );
  }
  
  /**
   * Parse stored market items from JSON
   */
  private async parseMarketItems(itemsJson: any): Promise<MarketItem[]> {
    // Handle both string and object cases
    const stored = typeof itemsJson === 'string' ? JSON.parse(itemsJson) : itemsJson;
    const items: MarketItem[] = [];
    
    for (const stored_item of stored) {
      const item = await db.query(
        'SELECT * FROM items WHERE id = $1',
        [stored_item.item_id]
      );
      
      if (item.rows[0]) {
        items.push({
          item: item.rows[0],
          price: stored_item.price,
          discount: stored_item.discount,
        });
      }
    }
    
    return items;
  }
  
  /**
   * Generate market message with pagination
   */
  generateMarketMessage(
    items: MarketItem[],
    playerGold: number,
    page: number = 0
  ): { message: string; totalPages: number } {
    const pageSize = 5;
    const totalPages = Math.ceil(items.length / pageSize);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const pageItems = items.slice(safePage * pageSize, (safePage + 1) * pageSize);
    
    let msg = `🏪 **Ежедневный Маркет**\n\n`;
    msg += `${ce(CUSTOM_EMOJI.gold, '💰')} Ваше золото: ${playerGold}\n`;
    msg += `📅 Обновление: завтра в 00:00\n\n`;
    msg += `📦 **Товары (стр. ${safePage + 1}/${totalPages}):**\n\n`;
    
    for (let i = 0; i < pageItems.length; i++) {
      const marketItem = pageItems[i];
      const item = marketItem.item;
      const rarityEmoji = this.getRarityEmoji(item.rarity);
      const globalIndex = safePage * pageSize + i;
      
      // Format stats at the top
      const statsParts = [];
      if (item.attack_bonus > 0) statsParts.push(`+${item.attack_bonus} ATK`);
      if (item.defense_bonus > 0) statsParts.push(`+${item.defense_bonus} DEF`);
      if (item.hp_bonus > 0) statsParts.push(`+${item.hp_bonus} HP`);
      if (item.crit_chance_bonus > 0) statsParts.push(`+${item.crit_chance_bonus}% CRIT`);
      if (item.dodge_bonus > 0) statsParts.push(`+${item.dodge_bonus}% DODGE`);
      if (item.lifesteal_bonus > 0) statsParts.push(`+${item.lifesteal_bonus}% LIFESTEAL`);
      if (item.ai_resist_bonus > 0) statsParts.push(`+${item.ai_resist_bonus}% AI RES`);
      
      const stats = statsParts.length > 0 ? statsParts.join(', ') : 'нет базовых стат';
      
      msg += `${globalIndex + 1}. ${rarityEmoji} **${item.name}**\n`;
      msg += `   📊 ${stats}\n`;
      msg += `   ⭐ Треб. ур.: ${item.level_required}\n`;
      
      if (item.special_effect) {
        msg += `   🌟 *${item.special_effect}*\n`;
      }
      
      // Price
      if (marketItem.discount && marketItem.discount > 0) {
        const originalPrice = Math.floor(marketItem.price / (1 - marketItem.discount / 100));
        msg += `   💲 ~~${originalPrice}~~ → **${marketItem.price}** золота (-${marketItem.discount}%)\n`;
      } else {
        msg += `   💲 **${marketItem.price}** золота\n`;
      }
      
      msg += `\n`;
    }
    
    return { message: msg, totalPages };
  }
  
  /**
   * Generate keyboard with pagination
   */
  generateMarketKeyboard(
    items: MarketItem[],
    page: number,
    userId: number,
    canReroll: boolean = false
  ): InlineKeyboard {
    const pageSize = 5;
    const totalPages = Math.ceil(items.length / pageSize);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const pageItems = items.slice(safePage * pageSize, (safePage + 1) * pageSize);
    
    const keyboard = new InlineKeyboard();
    
    // Item buttons
    for (let i = 0; i < pageItems.length; i++) {
      const marketItem = pageItems[i];
      const globalIndex = safePage * pageSize + i;
      
      keyboard.text(
        `${globalIndex + 1}. ${marketItem.item.name}`,
        `market:buy:${globalIndex}:${userId}`
      ).row();
    }
    
    // Pagination
    if (totalPages > 1) {
      keyboard
        .text('⬅️', `market:page:${Math.max(0, safePage - 1)}:${userId}`)
        .text(`${safePage + 1}/${totalPages}`, `market:page:${safePage}:${userId}`)
        .text('➡️', `market:page:${Math.min(totalPages - 1, safePage + 1)}:${userId}`)
        .row();
    }
    
    keyboard.text('💰 Продать предмет', `market:sell:0:${userId}`).row();
    if (canReroll) {
      keyboard.text('🎲 Сменить маркет (бесплатно)', `market:reroll:${userId}`).row();
    }
    keyboard.text('📊 Статус', `status:back:${userId}`).text('❌ Закрыть', `market:close:${userId}`);

    return keyboard;
  }

  /**
   * Build the sell view: every inventory item with the gold it is worth.
   */
  generateSellMenu(
    inventory: { id: number; name: string; rarity: string; quantity: number }[],
    playerGold: number,
    page: number,
    userId: number
  ): { message: string; keyboard: InlineKeyboard } {
    const pageSize = 5;
    const totalPages = Math.max(1, Math.ceil(inventory.length / pageSize));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const pageItems = inventory.slice(safePage * pageSize, (safePage + 1) * pageSize);

    let msg = `💰 **Продажа предметов**\n\n`;
    msg += `${ce(CUSTOM_EMOJI.gold, '💰')} Ваше золото: ${playerGold}\n\n`;

    const keyboard = new InlineKeyboard();

    if (pageItems.length === 0) {
      msg += `📦 Инвентарь пуст — продавать нечего.\n`;
    } else {
      msg += `Выберите предмет, чтобы продать одну штуку за половину стоимости:\n\n`;
      for (let i = 0; i < pageItems.length; i++) {
        const item = pageItems[i];
        const globalIndex = safePage * pageSize + i;
        const price = merchantService.getSellPrice(item.rarity);
        msg += `${this.getRarityEmoji(item.rarity)} ${item.name} x${item.quantity} — ${price} ${ce(CUSTOM_EMOJI.gold, '💰')}\n`;
        keyboard.text(
          `${globalIndex + 1}. ${item.name} · ${price}💰`,
          `market:sellitem:${item.id}:${safePage}:${userId}`
        ).row();
      }
    }

    if (totalPages > 1) {
      keyboard
        .text('⬅️', `market:sell:${Math.max(0, safePage - 1)}:${userId}`)
        .text(`${safePage + 1}/${totalPages}`, `market:sell:${safePage}:${userId}`)
        .text('➡️', `market:sell:${Math.min(totalPages - 1, safePage + 1)}:${userId}`)
        .row();
    }

    keyboard.text('🔙 Назад в маркет', `market:page:0:${userId}`).text('📊 Статус', `status:back:${userId}`);

    return { message: msg, keyboard };
  }
  
  /**
   * Buy item from market
   */
  async buyItem(
    playerProgressId: number,
    itemIndex: number
  ): Promise<{ success: boolean; message: string }> {
    const items = await this.getTodayMarket();
    
    if (itemIndex < 0 || itemIndex >= items.length) {
      return { success: false, message: '❌ Предмет не найден.' };
    }
    
    const marketItem = items[itemIndex];
    const price = marketItem.price;
    
    // Get player gold
    const progress = await db.query(
      'SELECT gold FROM player_progress WHERE id = $1',
      [playerProgressId]
    );
    
    if (progress.rows.length === 0) {
      return { success: false, message: '❌ Игрок не найден.' };
    }
    
    const playerGold = progress.rows[0].gold;
    
    if (playerGold < price) {
      return {
        success: false,
        message: `❌ Недостаточно золота! Нужно ${price}, у вас ${playerGold}.`,
      };
    }
    
    // Deduct gold
    await db.query(
      'UPDATE player_progress SET gold = gold - $1, updated_at = NOW() WHERE id = $2',
      [price, playerProgressId]
    );
    
    // Add item to inventory
    await lootService.addItemToInventory(playerProgressId, marketItem.item.id);
    
    return {
      success: true,
      message: `✅ Вы купили: **${marketItem.item.name}** за ${price} золота!\n\nОсталось золота: ${playerGold - price}`,
    };
  }
  
  /**
   * Convert date string to seed number
   */
  private dateSeed(dateStr: string): number {
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
      const char = dateStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
  
  /**
   * Get rarity emoji
   */
  private getRarityEmoji(rarity: string): string {
    switch (rarity) {
      case 'mythic': return '🌟';
      case 'legendary': return '⭐';
      case 'epic': return '💜';
      case 'rare': return '💙';
      case 'uncommon': return '💚';
      case 'common': return '⚪';
      default: return '📦';
    }
  }
}

export const dailyMarketService = new DailyMarketService();
