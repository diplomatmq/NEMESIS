import { db } from '../database/db';
import { ItemRarity } from '../types/game.types';

export interface Item {
  id: number;
  name: string;
  description: string;
  slot: string;
  rarity: ItemRarity;
  hp_bonus: number;
  attack_bonus: number;
  defense_bonus: number;
  crit_chance_bonus: number;
  dodge_bonus: number;
  lifesteal_bonus: number;
  ai_resist_bonus: number;
  special_effect?: string;
  class_restricted?: string;
  level_required: number;
}

export interface LootDrop {
  items: Item[];
  gold: number;
  message: string;
}

export class LootService {
  
  async generateLoot(floor: number, isBoss: boolean): Promise<LootDrop> {
    const drops: Item[] = [];
    let gold = 0;

    if (isBoss) {
      // Босс всегда даёт предмет
      gold = 50 + (floor * 5);
      const item = await this.generateRandomItem(floor, 0.7); // 70% шанс на редкий+
      if (item) {
        drops.push(item);
      }
    } else {
      // Обычный враг
      gold = 10 + (floor * 2);
      
      // 30% шанс на дроп предмета
      if (Math.random() < 0.3) {
        const item = await this.generateRandomItem(floor, 0.3); // 30% шанс на редкий+
        if (item) {
          drops.push(item);
        }
      }
    }

    const message = this.generateLootMessage(drops, gold, isBoss);

    return {
      items: drops,
      gold,
      message,
    };
  }

  private async generateRandomItem(floor: number, rareChance: number): Promise<Item | null> {
    // Determine rarity
    let rarity: ItemRarity;
    const roll = Math.random();

    if (roll < 0.01 && floor > 100) {
      rarity = ItemRarity.MYTHIC; // 1% на высоких этажах
    } else if (roll < 0.05 && floor > 50) {
      rarity = ItemRarity.LEGENDARY; // 4% на высоких этажах
    } else if (roll < (0.05 + rareChance)) {
      rarity = ItemRarity.EPIC;
    } else if (roll < (0.15 + rareChance)) {
      rarity = ItemRarity.RARE;
    } else if (roll < 0.5) {
      rarity = ItemRarity.UNCOMMON;
    } else {
      rarity = ItemRarity.COMMON;
    }

    // Get random item from database
    const result = await db.query(
      `SELECT * FROM items 
       WHERE rarity = $1 AND level_required <= $2
       ORDER BY RANDOM()
       LIMIT 1`,
      [rarity, Math.floor(floor / 10) + 1]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  }

  private generateLootMessage(items: Item[], gold: number, isBoss: boolean): string {
    let msg = '';

    if (isBoss) {
      msg += `\n🎁 **БОСС ПОВЕРЖЕН!**\n\n`;
    } else {
      msg += `\n💰 Добыча:\n`;
    }

    if (gold > 0) {
      msg += `💰 +${gold} золота\n`;
    }

    if (items.length > 0) {
      msg += `\n📦 Предметы:\n`;
      for (const item of items) {
        const rarityEmoji = this.getRarityEmoji(item.rarity);
        msg += `${rarityEmoji} **${item.name}** (${item.slot})\n`;
        
        if (item.attack_bonus > 0) msg += `   ⚔️ +${item.attack_bonus} ATK\n`;
        if (item.defense_bonus > 0) msg += `   🛡️ +${item.defense_bonus} DEF\n`;
        if (item.hp_bonus > 0) msg += `   ❤️ +${item.hp_bonus} HP\n`;
      }
    }

    return msg;
  }

  private getRarityEmoji(rarity: ItemRarity): string {
    switch (rarity) {
      case ItemRarity.MYTHIC: return '🌟';
      case ItemRarity.LEGENDARY: return '⭐';
      case ItemRarity.EPIC: return '💜';
      case ItemRarity.RARE: return '💙';
      case ItemRarity.UNCOMMON: return '💚';
      case ItemRarity.COMMON: return '⚪';
      default: return '📦';
    }
  }

  async addItemToInventory(playerProgressId: number, itemId: number): Promise<void> {
    // Check if item already in inventory
    const existing = await db.query(
      `SELECT * FROM player_inventory 
       WHERE player_progress_id = $1 AND item_id = $2`,
      [playerProgressId, itemId]
    );

    if (existing.rows.length > 0) {
      // Increment quantity
      await db.query(
        `UPDATE player_inventory 
         SET quantity = quantity + 1 
         WHERE player_progress_id = $1 AND item_id = $2`,
        [playerProgressId, itemId]
      );
    } else {
      // Add new item
      await db.query(
        `INSERT INTO player_inventory (player_progress_id, item_id, quantity)
         VALUES ($1, $2, 1)`,
        [playerProgressId, itemId]
      );
    }
  }

  async addGold(playerProgressId: number, amount: number): Promise<void> {
    await db.query(
      `UPDATE player_progress 
       SET gold = gold + $1 
       WHERE id = $2`,
      [amount, playerProgressId]
    );
  }

  async getInventory(playerProgressId: number): Promise<any[]> {
    const result = await db.query(
      `SELECT i.*, pi.quantity, pi.acquired_at
       FROM player_inventory pi
       JOIN items i ON pi.item_id = i.id
       WHERE pi.player_progress_id = $1
       ORDER BY i.rarity DESC, i.name`,
      [playerProgressId]
    );

    return result.rows;
  }

  async getEquipment(playerProgressId: number): Promise<any> {
    const result = await db.query(
      `SELECT * FROM player_equipment WHERE player_progress_id = $1`,
      [playerProgressId]
    );

    return result.rows[0] || null;
  }

  async equipItem(playerProgressId: number, itemId: number): Promise<boolean> {
    const item = await this.getItem(itemId);
    if (!item) return false;

    // Check if equipment record exists
    const equipment = await this.getEquipment(playerProgressId);
    
    const slotColumn = `${item.slot}_id`;
    
    if (!equipment) {
      // Create equipment record
      await db.query(
        `INSERT INTO player_equipment (player_progress_id, ${slotColumn})
         VALUES ($1, $2)`,
        [playerProgressId, itemId]
      );
    } else {
      // Update equipment slot
      await db.query(
        `UPDATE player_equipment 
         SET ${slotColumn} = $1, updated_at = NOW()
         WHERE player_progress_id = $2`,
        [itemId, playerProgressId]
      );
    }

    // Recalculate player stats
    await this.recalculateStats(playerProgressId);

    return true;
  }

  private async getItem(itemId: number): Promise<Item | null> {
    const result = await db.query('SELECT * FROM items WHERE id = $1', [itemId]);
    return result.rows[0] || null;
  }

  private async recalculateStats(playerProgressId: number): Promise<void> {
    // Get base class stats
    const progress = await db.query(
      `SELECT pp.*, c.base_hp, c.base_attack, c.base_defense
       FROM player_progress pp
       LEFT JOIN classes c ON pp.class_id = c.id
       WHERE pp.id = $1`,
      [playerProgressId]
    );

    if (progress.rows.length === 0) return;

    const player = progress.rows[0];
    let totalHp = player.base_hp || 100;
    let totalAttack = player.base_attack || 10;
    let totalDefense = player.base_defense || 5;

    // Get equipped items
    const equipment = await this.getEquipment(playerProgressId);
    
    if (equipment) {
      const itemIds = [
        equipment.weapon_id,
        equipment.shield_id,
        equipment.helmet_id,
        equipment.armor_id,
        equipment.boots_id,
        equipment.accessory_id,
      ].filter(id => id !== null);

      if (itemIds.length > 0) {
        const items = await db.query(
          `SELECT * FROM items WHERE id = ANY($1)`,
          [itemIds]
        );

        for (const item of items.rows) {
          totalHp += item.hp_bonus || 0;
          totalAttack += item.attack_bonus || 0;
          totalDefense += item.defense_bonus || 0;
        }
      }
    }

    // Update player stats
    await db.query(
      `UPDATE player_progress 
       SET max_hp = $1, attack = $2, defense = $3, updated_at = NOW()
       WHERE id = $4`,
      [totalHp, totalAttack, totalDefense, playerProgressId]
    );
  }
}

export const lootService = new LootService();
