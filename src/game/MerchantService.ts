import { db } from '../database/db';
import { InlineKeyboard } from 'grammy';
import { lootService, Item } from './LootService';

export interface MerchantOffer {
  item: Item;
  price: number;
  discount?: number;
}

export class MerchantService {
  
  async generateMerchantOffers(floor: number): Promise<MerchantOffer[]> {
    const level = Math.floor(floor / 10) + 1;
    const offers: MerchantOffer[] = [];

    // Generate 3-5 random items
    const offerCount = 3 + Math.floor(Math.random() * 3);

    for (let i = 0; i < offerCount; i++) {
      const rarity = this.selectRarity(floor);
      const item = await this.getRandomItem(level, rarity);
      
      if (item) {
        const basePrice = this.calculateBasePrice(item, level);
        const discount = Math.random() < 0.2 ? 10 + Math.floor(Math.random() * 20) : 0; // 20% chance for discount
        
        offers.push({
          item,
          price: Math.floor(basePrice * (1 - discount / 100)),
          discount,
        });
      }
    }

    return offers;
  }

  private selectRarity(floor: number): string {
    const roll = Math.random();
    
    if (floor > 100 && roll < 0.05) return 'legendary';
    if (floor > 50 && roll < 0.15) return 'epic';
    if (roll < 0.35) return 'rare';
    if (roll < 0.65) return 'uncommon';
    return 'common';
  }

  private async getRandomItem(level: number, rarity: string): Promise<Item | null> {
    const result = await db.query(
      `SELECT * FROM items 
       WHERE rarity = $1 AND level_required <= $2
       ORDER BY RANDOM()
       LIMIT 1`,
      [rarity, level]
    );

    return result.rows[0] || null;
  }

  private calculateBasePrice(item: Item, level: number): number {
    const rarityMultipliers: Record<string, number> = {
      common: 1,
      uncommon: 2,
      rare: 4,
      epic: 8,
      legendary: 16,
      mythic: 32,
    };

    const multiplier = rarityMultipliers[item.rarity] || 1;
    const baseValue = 50 + (level * 25);
    
    return Math.floor(baseValue * multiplier);
  }

  generateMerchantMessage(offers: MerchantOffer[], playerGold: number): string {
    let msg = `🛒 **Торговец Башни**\n\n`;
    msg += `"Добро пожаловать, путник! Посмотри на мои товары."\n\n`;
    msg += `💰 Ваше золото: ${playerGold}\n\n`;
    msg += `📦 **Товары:**\n\n`;

    for (let i = 0; i < offers.length; i++) {
      const offer = offers[i];
      const rarityEmoji = this.getRarityEmoji(offer.item.rarity);
      
      msg += `${i + 1}. ${rarityEmoji} **${offer.item.name}**\n`;
      msg += `   ${offer.item.description}\n`;
      
      if (offer.item.attack_bonus > 0) msg += `   ⚔️ +${offer.item.attack_bonus} ATK\n`;
      if (offer.item.defense_bonus > 0) msg += `   🛡️ +${offer.item.defense_bonus} DEF\n`;
      if (offer.item.hp_bonus > 0) msg += `   ❤️ +${offer.item.hp_bonus} HP\n`;
      
      if (offer.discount && offer.discount > 0) {
        const originalPrice = Math.floor(offer.price / (1 - offer.discount / 100));
        msg += `   💲 ~~${originalPrice}~~ → **${offer.price}** золота (-${offer.discount}%)\n`;
      } else {
        msg += `   💲 **${offer.price}** золота\n`;
      }
      
      msg += `\n`;
    }

    msg += `Используйте команду: купить [номер]`;

    return msg;
  }

  generateMerchantKeyboard(offers: MerchantOffer[]): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    
    for (let i = 0; i < offers.length; i++) {
      keyboard.text(`${i + 1}. ${offers[i].item.name}`, `buy:${offers[i].item.id}:${offers[i].price}`);
      if ((i + 1) % 2 === 0) {
        keyboard.row();
      }
    }
    
    keyboard.row();
    keyboard.text('❌ Уйти', 'merchant:leave');
    
    return keyboard;
  }

  async buyItem(
    playerProgressId: number,
    itemId: number,
    price: number
  ): Promise<{ success: boolean; message: string }> {
    
    // Get player gold
    const progress = await db.query(
      'SELECT gold FROM player_progress WHERE id = $1',
      [playerProgressId]
    );

    if (progress.rows.length === 0) {
      return { success: false, message: 'Игрок не найден.' };
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
      'UPDATE player_progress SET gold = gold - $1 WHERE id = $2',
      [price, playerProgressId]
    );

    // Add item to inventory
    await lootService.addItemToInventory(playerProgressId, itemId);

    // Get item info
    const item = await db.query('SELECT name FROM items WHERE id = $1', [itemId]);
    const itemName = item.rows[0]?.name || 'Предмет';

    return {
      success: true,
      message: `✅ Вы купили: **${itemName}** за ${price} золота!\n\nОсталось золота: ${playerGold - price}`,
    };
  }

  async sellItem(
    playerProgressId: number,
    itemId: number
  ): Promise<{ success: boolean; message: string; gold?: number }> {
    
    // Check if player has this item
    const inventory = await db.query(
      `SELECT pi.quantity, i.name, i.rarity
       FROM player_inventory pi
       JOIN items i ON pi.item_id = i.id
       WHERE pi.player_progress_id = $1 AND pi.item_id = $2`,
      [playerProgressId, itemId]
    );

    if (inventory.rows.length === 0) {
      return { success: false, message: 'У вас нет этого предмета.' };
    }

    const item = inventory.rows[0];
    const quantity = item.quantity;

    // Calculate sell price (50% of base value)
    const rarityValues: Record<string, number> = {
      common: 25,
      uncommon: 50,
      rare: 100,
      epic: 200,
      legendary: 400,
      mythic: 800,
    };

    const sellPrice = rarityValues[item.rarity] || 25;

    // Remove one item
    if (quantity > 1) {
      await db.query(
        `UPDATE player_inventory 
         SET quantity = quantity - 1 
         WHERE player_progress_id = $1 AND item_id = $2`,
        [playerProgressId, itemId]
      );
    } else {
      await db.query(
        `DELETE FROM player_inventory 
         WHERE player_progress_id = $1 AND item_id = $2`,
        [playerProgressId, itemId]
      );
    }

    // Add gold
    await db.query(
      'UPDATE player_progress SET gold = gold + $1 WHERE id = $2',
      [sellPrice, playerProgressId]
    );

    return {
      success: true,
      message: `✅ Вы продали: **${item.name}** за ${sellPrice} золота!`,
      gold: sellPrice,
    };
  }

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

export const merchantService = new MerchantService();
