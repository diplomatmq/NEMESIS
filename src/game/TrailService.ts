import { InlineKeyboard } from 'grammy';
import { db } from '../database/db';
import { lootService } from './LootService';
import { merchantService } from './MerchantService';
import { CUSTOM_EMOJI, ce } from './CustomEmoji';

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
      { label: 'Влево', kind: 'combat', modifier: 0.85 },
      { label: 'Вперёд', kind: 'combat', modifier: 1.2 },
      { label: 'Вправо', kind: 'market' },
    ];

    const shuffled = options.sort(() => Math.random() - 0.5);
    const result = await db.query(
      `INSERT INTO trail_events (user_id, season_id, chat_id, floor, options)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, season_id, chat_id) DO UPDATE
       SET floor = EXCLUDED.floor,
           options = EXCLUDED.options, created_at = NOW()
       RETURNING id`,
      [userId, seasonId, chatId, floor, JSON.stringify(shuffled)]
    );

    return {
      message:
        '\n🧭 **Выберите путь**\n' +
        'Направление каждой кнопки определяется случайно. Отказаться от выбора нельзя.\n',
      keyboard: this.createKeyboard(result.rows[0].id, shuffled),
    };
  }

  async getEvent(userId: number, seasonId: number, chatId: number): Promise<TrailEvent | null> {
    const result = await db.query(
      `SELECT id, floor, options FROM trail_events
       WHERE user_id = $1 AND season_id = $2 AND chat_id = $3`,
      [userId, seasonId, chatId]
    );
    return result.rows[0] || null;
  }

  async resolveEvent(
    userId: number,
    seasonId: number,
    progressId: number,
    chatId: number,
    eventId: number,
    optionIndex: number
  ): Promise<TrailResult> {
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 2) {
      return { message: 'Вариант следа не найден.' };
    }

    const result = await db.query(
      `DELETE FROM trail_events
       WHERE id = $1 AND user_id = $2 AND season_id = $3 AND chat_id = $4
       RETURNING id, floor, options`,
      [eventId, userId, seasonId, chatId]
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

    return this.createMarket(progressId, chatId, event.floor);
  }

  private async createMarket(
    progressId: number,
    chatId: number,
    floor: number
  ): Promise<TrailResult> {
    const level = Math.floor(floor / 10) + 1;
    
    // Generate 3 random items with proper rarity distribution
    const items = [];
    for (let i = 0; i < 3; i++) {
      const rarity = this.selectMarketRarity(floor);
      const item = await db.query(
        `SELECT id, name, description, rarity, attack_bonus, defense_bonus, 
                hp_bonus, crit_chance_bonus, dodge_bonus, lifesteal_bonus, 
                ai_resist_bonus, special_effect, slot
         FROM items
         WHERE rarity = $1 AND level_required <= $2 AND slot != 'potion'
         ORDER BY RANDOM() LIMIT 1`,
        [rarity, level]
      );
      
      if (item.rows[0]) {
        const price = this.calculateMarketPrice(item.rows[0], level);
        items.push({ ...item.rows[0], price });
      }
    }
    
    if (items.length === 0) {
      return { message: '🛒 Рынок пуст. След закончился, но вы ничего не потеряли.' };
    }

    const marketId = await this.saveMarket(progressId, chatId, items);
    
    // Create initial keyboard with action buttons
    const keyboard = new InlineKeyboard()
      .text('🛒 Купить', `trailmarket:${marketId}:mode:buy`)
      .text('💰 Продать', `trailmarket:${marketId}:mode:sell`)
      .row()
      .text('🔁 Обменять', `trailmarket:${marketId}:mode:exchange`);

    // Build message with item details
    let message = '🛒 **Обязательный рынок**\n\n';
    message += '📦 **Доступные товары:**\n\n';
    
    for (const [index, item] of items.entries()) {
      const rarityEmoji = this.getRarityEmoji(item.rarity);
      
      // Format stats
      const statsParts = [];
      if (item.attack_bonus > 0) statsParts.push(`+${item.attack_bonus} ATK`);
      if (item.defense_bonus > 0) statsParts.push(`+${item.defense_bonus} DEF`);
      if (item.hp_bonus > 0) statsParts.push(`+${item.hp_bonus} HP`);
      if (item.crit_chance_bonus > 0) statsParts.push(`+${item.crit_chance_bonus}% CRIT`);
      if (item.dodge_bonus > 0) statsParts.push(`+${item.dodge_bonus}% DODGE`);
      if (item.lifesteal_bonus > 0) statsParts.push(`+${item.lifesteal_bonus}% LIFESTEAL`);
      if (item.ai_resist_bonus > 0) statsParts.push(`+${item.ai_resist_bonus}% AI RES`);
      
      const stats = statsParts.length > 0 ? statsParts.join(', ') : 'нет базовых стат';
      
      message += `${index + 1}. ${rarityEmoji} **${item.name}**\n`;
      message += `   📊 ${stats}\n`;
      if (item.special_effect) {
        message += `   🌟 *${item.special_effect}*\n`;
      }
      message += `   ${ce(CUSTOM_EMOJI.gold, '💰')} ${item.price} золота\n\n`;
    }
    
    message += '\n💡 Выберите действие: купить, продать или обменять.';

    return { message, keyboard };
  }

  /**
   * Select rarity for trail market items
   * Can include very rare items
   */
  private selectMarketRarity(floor: number): string {
    const roll = Math.random();
    
    // Mythic - 0.5% chance after floor 200
    if (floor > 200 && roll < 0.005) return 'mythic';
    
    // Legendary - 1% chance after floor 150
    if (floor > 150 && roll < 0.015) return 'legendary';
    
    // Epic - 5% chance after floor 100
    if (floor > 100 && roll < 0.065) return 'epic';
    
    // Rare - 15% chance
    if (roll < 0.215) return 'rare';
    
    // Uncommon - 30% chance
    if (roll < 0.515) return 'uncommon';
    
    // Common - rest
    return 'common';
  }

  /**
   * Calculate price for market item based on rarity
   */
  private calculateMarketPrice(item: any, level: number): number {
    const rarityPrices: Record<string, number> = {
      common: 50,
      uncommon: 150,
      rare: 400,
      epic: 1200,
      legendary: 5000,
      mythic: 20000,
    };
    
    const basePrice = rarityPrices[item.rarity] || 50;
    const levelMultiplier = 1 + (level * 0.1);
    
    return Math.floor(basePrice * levelMultiplier);
  }

  async resolveMarket(
    userId: number,
    progressId: number,
    chatId: number,
    marketId: number,
    offerIndex: number
  ): Promise<string> {
    const result = await db.query(
      `DELETE FROM trail_markets WHERE id = $1 AND player_progress_id = $2 AND chat_id = $3
       RETURNING offers`,
      [marketId, progressId, chatId]
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
      return `✅ Вы купили **${offer.name}** за ${ce(CUSTOM_EMOJI.gold, '💰')} ${offer.price} золота. Отказаться от сделки было нельзя.`;
    }

    const owned = await db.query(
      `SELECT item_id FROM player_inventory
       WHERE player_progress_id = $1 ORDER BY quantity DESC, id LIMIT 1`,
      [progressId]
    );
    if (owned.rows[0]) {
      await merchantService.sellItem(progressId, owned.rows[0].item_id);
      await lootService.addItemToInventory(progressId, offer.id);
      return `${ce(CUSTOM_EMOJI.gold, '💰')} 🔁 Золота не хватило: ваш предмет был автоматически обменян на **${offer.name}**.`;
    }

    await lootService.addItemToInventory(progressId, offer.id);
    return `🎁 У вас не было ресурсов для оплаты, поэтому рынок отдал **${offer.name}** бесплатно.`;
  }

  async resolveMarketAction(
    userId: number,
    progressId: number,
    chatId: number,
    marketId: number,
    action: 'buy' | 'sell' | 'exchange',
    itemIndex?: number,
    page: number = 0
  ): Promise<TrailResult> {
    // Get market data
    const market = await db.query(
      `SELECT offers FROM trail_markets
       WHERE id = $1 AND player_progress_id = $2 AND chat_id = $3`,
      [marketId, progressId, chatId]
    );
    
    if (!market.rows[0]) return { message: 'Этот рынок уже закрыт или устарел.' };
    
    const offers = market.rows[0].offers as Array<any>;
    
    // Mode selection - show items for that mode
    if (itemIndex === undefined) {
      if (action === 'buy') {
        return this.showBuyMode(marketId, offers);
      } else if (action === 'sell') {
        return this.showSellMode(progressId, marketId, page);
      } else if (action === 'exchange') {
        return this.showExchangeSelectMarketItem(marketId, offers);
      }
    }
    
    // Action execution
    if (action === 'buy' && itemIndex !== undefined) {
      return await this.executeBuy(progressId, chatId, marketId, offers, itemIndex);
    } else if (action === 'sell' && itemIndex !== undefined) {
      return await this.executeSell(progressId, chatId, marketId, itemIndex);
    } else if (action === 'exchange' && itemIndex !== undefined) {
      return await this.executeExchange(progressId, chatId, marketId, offers, itemIndex);
    }
    
    return { message: '❌ Неизвестное действие.' };
  }

  /**
   * Show buy mode - display market items
   */
  private showBuyMode(marketId: number, offers: any[]): TrailResult {
    const keyboard = new InlineKeyboard();
    
    for (const [index, offer] of offers.entries()) {
      const rarityEmoji = this.getRarityEmoji(offer.rarity);
      const style = this.isVeryRare(offer.rarity) ? 'danger' : 'primary';
      
      keyboard.text(
        `${index + 1}. ${rarityEmoji} ${offer.name}`,
        `trailmarket:${marketId}:buy:${index}`
      );
      
      if (style === 'danger') {
        keyboard.style('danger');
      }
      
      keyboard.row();
    }
    
    keyboard.text('« Назад', `trailmarket:${marketId}:mode:main`);
    
    let message = '🛒 **Купить предмет**\n\n';
    for (const [index, offer] of offers.entries()) {
      const rarityEmoji = this.getRarityEmoji(offer.rarity);
      message += `${index + 1}. ${rarityEmoji} **${offer.name}** — ${offer.price} ${ce(CUSTOM_EMOJI.gold, '💰')}\n`;
    }
    
    return { message, keyboard };
  }

  /**
   * Show sell mode - display player inventory with pagination
   */
  async showSellMode(
    progressId: number,
    marketId: number,
    page: number
  ): Promise<TrailResult> {
    const inventory = await db.query(
      `SELECT pi.item_id, i.name, i.rarity, pi.quantity
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       WHERE pi.player_progress_id = $1 AND pi.quantity > 0
       ORDER BY i.rarity DESC, i.name`,
      [progressId]
    );
    
    if (inventory.rows.length === 0) {
      return { 
        message: '❌ У вас нет предметов для продажи.',
        keyboard: new InlineKeyboard().text('« Назад', `trailmarket:${marketId}:mode:main`)
      };
    }
    
    const pageSize = 5;
    const totalPages = Math.ceil(inventory.rows.length / pageSize);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const items = inventory.rows.slice(safePage * pageSize, (safePage + 1) * pageSize);
    
    const keyboard = new InlineKeyboard();
    
    for (const [index, item] of items.entries()) {
      const globalIndex = safePage * pageSize + index;
      const rarityEmoji = this.getRarityEmoji(item.rarity);
      
      keyboard.text(
        `${rarityEmoji} ${item.name} (x${item.quantity})`,
        `trailmarket:${marketId}:sell:${globalIndex}`
      ).row();
    }
    
    // Pagination
    if (totalPages > 1) {
      keyboard
        .text('⬅️', `trailmarket:${marketId}:sellpage:${Math.max(0, safePage - 1)}`)
        .text(`${safePage + 1}/${totalPages}`, `trailmarket:${marketId}:sellpage:${safePage}`)
        .text('➡️', `trailmarket:${marketId}:sellpage:${Math.min(totalPages - 1, safePage + 1)}`)
        .row();
    }
    
    keyboard.text('« Назад', `trailmarket:${marketId}:mode:main`);
    
    let message = `${ce(CUSTOM_EMOJI.gold, '💰')} **Продать предмет**\n\n`;
    message += `📦 Страница ${safePage + 1}/${totalPages}\n\n`;
    message += 'Выберите предмет для продажи:';
    
    return { message, keyboard };
  }

  /**
   * Show exchange mode step 1 - select market item
   */
  private showExchangeSelectMarketItem(marketId: number, offers: any[]): TrailResult {
    const keyboard = new InlineKeyboard();
    
    for (const [index, offer] of offers.entries()) {
      const rarityEmoji = this.getRarityEmoji(offer.rarity);
      const style = this.isVeryRare(offer.rarity) ? 'danger' : 'primary';
      
      keyboard.text(
        `${index + 1}. ${rarityEmoji} ${offer.name}`,
        `trailmarket:${marketId}:exch1:${index}`
      );
      
      if (style === 'danger') {
        keyboard.style('danger');
      }
      
      keyboard.row();
    }
    
    keyboard.text('« Назад', `trailmarket:${marketId}:mode:main`);
    
    let message = '🔁 **Обмен (Шаг 1/2)**\n\n';
    message += 'Выберите предмет из маркета, который хотите получить:\n\n';
    
    for (const [index, offer] of offers.entries()) {
      const rarityEmoji = this.getRarityEmoji(offer.rarity);
      message += `${index + 1}. ${rarityEmoji} **${offer.name}**\n`;
    }
    
    return { message, keyboard };
  }

  /**
   * Show exchange mode step 2 - select player item to give
   */
  async showExchangeSelectPlayerItem(
    progressId: number,
    marketId: number,
    marketItemIndex: number,
    page: number = 0
  ): Promise<TrailResult> {
    const inventory = await db.query(
      `SELECT pi.item_id, i.name, i.rarity, pi.quantity
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       WHERE pi.player_progress_id = $1 AND pi.quantity > 0
       ORDER BY i.rarity DESC, i.name`,
      [progressId]
    );
    
    if (inventory.rows.length === 0) {
      return { 
        message: '❌ У вас нет предметов для обмена.',
        keyboard: new InlineKeyboard().text('« Назад', `trailmarket:${marketId}:mode:exchange`)
      };
    }
    
    const pageSize = 5;
    const totalPages = Math.ceil(inventory.rows.length / pageSize);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const items = inventory.rows.slice(safePage * pageSize, (safePage + 1) * pageSize);
    
    const keyboard = new InlineKeyboard();
    
    for (const [index, item] of items.entries()) {
      const globalIndex = safePage * pageSize + index;
      const rarityEmoji = this.getRarityEmoji(item.rarity);
      
      keyboard.text(
        `${rarityEmoji} ${item.name} (x${item.quantity})`,
        `trailmarket:${marketId}:exch2:${marketItemIndex}:${globalIndex}`
      ).row();
    }
    
    // Pagination
    if (totalPages > 1) {
      keyboard
        .text('⬅️', `trailmarket:${marketId}:exchpage:${marketItemIndex}:${Math.max(0, safePage - 1)}`)
        .text(`${safePage + 1}/${totalPages}`, `trailmarket:${marketId}:exchpage:${marketItemIndex}:${safePage}`)
        .text('➡️', `trailmarket:${marketId}:exchpage:${marketItemIndex}:${Math.min(totalPages - 1, safePage + 1)}`)
        .row();
    }
    
    keyboard.text('« Назад', `trailmarket:${marketId}:mode:exchange`);
    
    let message = '🔁 **Обмен (Шаг 2/2)**\n\n';
    message += `📦 Страница ${safePage + 1}/${totalPages}\n\n`;
    message += 'Выберите свой предмет для обмена:';
    
    return { message, keyboard };
  }

  /**
   * Execute buy action
   */
  private async executeBuy(
    progressId: number,
    chatId: number,
    marketId: number,
    offers: any[],
    itemIndex: number
  ): Promise<TrailResult> {
    const offer = offers[itemIndex];
    if (!offer) return { message: '❌ Предмет не найден.' };
    
    const progress = await db.query(
      'SELECT gold FROM player_progress WHERE id = $1',
      [progressId]
    );
    const gold = Number(progress.rows[0]?.gold || 0);
    
    if (gold < offer.price) {
      return { message: `❌ Недостаточно золота! Нужно ${offer.price}, у вас ${gold}.` };
    }
    
    // Deduct gold and add item
    await db.query('UPDATE player_progress SET gold = gold - $1 WHERE id = $2', [
      offer.price,
      progressId,
    ]);
    await lootService.addItemToInventory(progressId, offer.id);
    
    // Close market
    await db.query(
      'DELETE FROM trail_markets WHERE id = $1 AND player_progress_id = $2 AND chat_id = $3',
      [marketId, progressId, chatId]
    );
    
    return { 
      message: `✅ Вы купили **${offer.name}** за ${offer.price} золота!\n\nОсталось золота: ${gold - offer.price}`
    };
  }

  /**
   * Execute sell action
   */
  private async executeSell(
    progressId: number,
    chatId: number,
    marketId: number,
    inventoryIndex: number
  ): Promise<TrailResult> {
    const inventory = await db.query(
      `SELECT pi.item_id, i.name
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       WHERE pi.player_progress_id = $1 AND pi.quantity > 0
       ORDER BY i.rarity DESC, i.name`,
      [progressId]
    );
    
    const item = inventory.rows[inventoryIndex];
    if (!item) return { message: '❌ Предмет не найден.' };
    
    const result = await merchantService.sellItem(progressId, item.item_id);
    
    // Close market
    await db.query(
      'DELETE FROM trail_markets WHERE id = $1 AND player_progress_id = $2 AND chat_id = $3',
      [marketId, progressId, chatId]
    );
    
    return { message: result.message };
  }

  /**
   * Execute exchange action
   */
  private async executeExchange(
    progressId: number,
    chatId: number,
    marketId: number,
    offers: any[],
    playerItemIndex: number
  ): Promise<TrailResult> {
    // playerItemIndex format: marketItem_playerItem (e.g., "0_5")
    const parts = String(playerItemIndex).split('_');
    if (parts.length !== 2) return { message: '❌ Неверный формат.' };
    
    const marketItemIndex = Number(parts[0]);
    const inventoryIndex = Number(parts[1]);
    
    const marketItem = offers[marketItemIndex];
    if (!marketItem) return { message: '❌ Предмет маркета не найден.' };
    
    const inventory = await db.query(
      `SELECT pi.item_id, i.name
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       WHERE pi.player_progress_id = $1 AND pi.quantity > 0
       ORDER BY i.rarity DESC, i.name`,
      [progressId]
    );
    
    const playerItem = inventory.rows[inventoryIndex];
    if (!playerItem) return { message: '❌ Ваш предмет не найден.' };
    
    // Remove player item
    await merchantService.sellItem(progressId, playerItem.item_id);
    
    // Add market item
    await lootService.addItemToInventory(progressId, marketItem.id);
    
    // Close market
    await db.query(
      'DELETE FROM trail_markets WHERE id = $1 AND player_progress_id = $2 AND chat_id = $3',
      [marketId, progressId, chatId]
    );
    
    return { 
      message: `🔁 Обмен завершен!\n\nОтдали: **${playerItem.name}**\nПолучили: **${marketItem.name}**`
    };
  }

  /**
   * Check if rarity is very rare (legendary/mythic)
   */
  private isVeryRare(rarity: string): boolean {
    return rarity === 'legendary' || rarity === 'mythic';
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

  private async saveMarket(
    progressId: number,
    chatId: number,
    offers: unknown[]
  ): Promise<number> {
    const result = await db.query(
      `INSERT INTO trail_markets (player_progress_id, chat_id, offers)
       VALUES ($1, $2, $3) RETURNING id`,
      [progressId, chatId, JSON.stringify(offers)]
    );
    return result.rows[0].id;
  }

  private createKeyboard(id: number, options: TrailOption[]): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    options.forEach((option, index) => {
      keyboard.text(option.label, `trail:${id}:${index}`);
    });
    return keyboard;
  }
}

export const trailService = new TrailService();
