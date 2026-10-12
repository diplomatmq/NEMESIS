import { db } from '../database/db';
import { InlineKeyboard } from 'grammy';
import { lootService, Item } from './LootService';
import { SeededRandom } from './SeededRandom';

export interface MarketItem {
  item: Item;
  price: number;
  discount?: number;
}

export class DailyMarketService {
  
  /**
   * Get or generate today's market items
   */
  async getTodayMarket(): Promise<MarketItem[]> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Check if market exists for today
    const existing = await db.query(
      'SELECT items_json FROM daily_market WHERE market_date = $1',
      [today]
    );
    
    if (existing.rows.length > 0) {
      // Return existing market
      return this.parseMarketItems(existing.rows[0].items_json);
    }
    
    // Generate new market for today
    return await this.generateTodayMarket(today);
  }
  
  /**
   * Generate market for today with seeded randomness
   */
  private async generateTodayMarket(date: string): Promise<MarketItem[]> {
    // Use date as seed for reproducibility
    const seed = this.dateSeed(date);
    const rng = new SeededRandom(seed);
    
    const items: MarketItem[] = [];
    const itemCount = 10;
    
    // Determine how many epic items (0-2)
    const epicRoll = rng.next();
    let epicCount = 0;
    if (epicRoll < 0.3) epicCount = 1; // 30% chance for 1 epic
    else if (epicRoll < 0.4) epicCount = 2; // 10% chance for 2 epics
    
    // Generate items
    for (let i = 0; i < itemCount; i++) {
      const rarity = this.selectRarity(i, epicCount, itemCount, rng);
      const item = await this.getRandomItemByRarity(rarity, rng);
      
      if (item) {
        const basePrice = this.calculateBasePrice(item);
        const hasDiscount = rng.next() < 0.25; // 25% chance for discount
        const discount = hasDiscount ? 10 + Math.floor(rng.next() * 21) : 0; // 10-30% discount
        
        items.push({
          item,
          price: Math.floor(basePrice * (1 - discount / 100)),
          discount: discount > 0 ? discount : undefined,
        });
      }
    }
    
    // Store in database
    const itemsJson = items.map(mi => ({
      item_id: mi.item.id,
      price: mi.price,
      discount: mi.discount,
    }));
    
    await db.query(
      'INSERT INTO daily_market (market_date, items_json, seed) VALUES ($1, $2, $3)',
      [date, JSON.stringify(itemsJson), seed]
    );
    
    return items;
  }
  
  /**
   * Select rarity for item at position i
   */
  private selectRarity(
    index: number,
    epicCount: number,
    totalCount: number,
    rng: SeededRandom
  ): string {
    // First epicCount items are epic
    if (index < epicCount) {
      return 'epic';
    }
    
    // Rest are common/uncommon
    const roll = rng.next();
    if (roll < 0.7) return 'common'; // 70% common
    return 'uncommon'; // 30% uncommon
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
   * Calculate base price for item
   */
  private calculateBasePrice(item: Item): number {
    const rarityMultipliers: Record<string, number> = {
      common: 1,
      uncommon: 2,
      rare: 4,
      epic: 8,
      legendary: 16,
      mythic: 32,
    };
    
    const multiplier = rarityMultipliers[item.rarity] || 1;
    const baseValue = 100; // Base price for common items
    
    return Math.floor(baseValue * multiplier);
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
    msg += `💰 Ваше золото: ${playerGold}\n`;
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
    userId: number
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
      const canAfford = true; // We'll check in the buy handler
      
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
    
    keyboard.text('❌ Закрыть', `market:close:${userId}`);
    
    return keyboard;
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
