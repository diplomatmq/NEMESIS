import { db } from '../database/db';
import { PlayerProgressModel } from '../database/models/PlayerProgress';
import { ItemRarity, ItemType } from '../types/game.types';
import { potionService } from './PotionService';
import { SeededRandom } from './SeededRandom';

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
  item_type: ItemType;
  class_id?: number;
}

export interface LootDrop {
  items: Item[];
  gold: number;
  message: string;
}

export class LootService {
  
  async generateLootS1(
    floor: number, 
    isBoss: boolean, 
    playerProgressId: number,
    seasonId: number,
    rewardMultiplier: number = 1.0
  ): Promise<LootDrop> {
    const drops: Item[] = [];
    let gold = 0;

    if (isBoss) {
      // Boss gold
      gold = Math.floor((50 + (floor * 5)) * rewardMultiplier);
      
      // Boss ALWAYS drops 1 guaranteed item
      const guaranteedItem = await this.rollBossItem(floor);
      if (guaranteedItem) {
        drops.push(guaranteedItem);
      }
      
      // 10% chance for additional item
      if (Math.random() < 0.1) {
        const bonusItem = await this.rollBossItem(floor);
        if (bonusItem && bonusItem.id !== guaranteedItem?.id) {
          drops.push(bonusItem);
        }
      }
      
      // Boss always gives a potion
      await potionService.addPotionToInventory(playerProgressId, 'medium', 1);
    } else {
      // Regular mob - only gold, NO ITEMS
      gold = Math.floor((10 + (floor * 2)) * rewardMultiplier);
      
      // 20% chance for small potion
      if (Math.random() < 0.2) {
        await potionService.addPotionToInventory(playerProgressId, 'small', 1);
      }
    }

    const message = this.generateLootMessage(drops, gold, isBoss, rewardMultiplier);

    return {
      items: drops,
      gold,
      message,
    };
  }

  /**
   * Roll for boss item drop with rarity-based chances
   * Mythic: 0.01%, Legendary: 0.1%, Epic: 5%, Rare: 15%, Uncommon: 35%, Common: 44.99%
   */
  private async rollBossItem(floor: number): Promise<Item | null> {
    const level = Math.floor(floor / 10) + 1;
    
    // Rarity drop chances (lower = rarer)
    const rarityChances: Array<{ rarity: ItemRarity; chance: number }> = [
      { rarity: ItemRarity.MYTHIC, chance: 0.0001 },      // 0.01%
      { rarity: ItemRarity.LEGENDARY, chance: 0.001 },    // 0.1%
      { rarity: ItemRarity.EPIC, chance: 0.05 },          // 5%
      { rarity: ItemRarity.RARE, chance: 0.15 },          // 15%
      { rarity: ItemRarity.UNCOMMON, chance: 0.35 },      // 35%
      { rarity: ItemRarity.COMMON, chance: 0.4499 },      // 44.99%
    ];

    // Roll for rarity
    const roll = Math.random();
    let cumulativeChance = 0;
    let selectedRarity: ItemRarity = ItemRarity.COMMON;
    
    for (const { rarity, chance } of rarityChances) {
      cumulativeChance += chance;
      if (roll < cumulativeChance) {
        selectedRarity = rarity;
        break;
      }
    }

    // Get random item of selected rarity
    const result = await db.query(
      `SELECT * FROM items 
       WHERE rarity = $1 AND level_required <= $2 AND slot != 'potion'
       ORDER BY RANDOM() 
       LIMIT 1`,
      [selectedRarity, level]
    );

    return result.rows[0] || null;
  }


  private generateLootMessage(items: Item[], gold: number, isBoss: boolean, rewardMultiplier: number): string {
    let msg = '';
    
    if (rewardMultiplier < 1.0) {
      msg += `\n💰 Награды уменьшены на ${Math.floor((1 - rewardMultiplier) * 100)}% (дополнительный чат)\n`;
    }

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

    const owned = await db.query(
      `SELECT 1 FROM player_inventory
       WHERE player_progress_id = $1 AND item_id = $2 AND quantity > 0`,
      [playerProgressId, itemId]
    );
    if (!owned.rows[0] ||
        !['weapon', 'shield', 'helmet', 'armor', 'boots', 'accessory'].includes(item.slot)) {
      return false;
    }

    const progress = await db.query(
      'SELECT floor FROM player_progress WHERE id = $1',
      [playerProgressId]
    );
    if (!progress.rows[0] ||
        PlayerProgressModel.calculateLevel(Number(progress.rows[0].floor)) < item.level_required) {
      return false;
    }

    if (item.item_type === ItemType.CLASS_EXCLUSIVE) {
      const player = await db.query(
        `SELECT c.id AS class_id FROM player_progress pp
         LEFT JOIN classes c ON c.id = pp.class_id
         WHERE pp.id = $1`,
        [playerProgressId]
      );
      // Check if player has the right class for this item
      if (!player.rows[0]?.class_id || Number(player.rows[0].class_id) !== Number(item.class_id)) {
        return false;
      }
    }

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
      `      SELECT pp.*, c.code AS class_code, c.base_hp, c.base_attack, c.base_defense
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
    let totalCritChance = 0;
    let totalDodge = 0;
    let totalLifesteal = 0;
    let totalAiResist = 0;

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
          `SELECT i.*, icb.attack_percent, icb.defense_percent,
                  icb.hp_percent, icb.crit_percent, icb.dodge_percent,
                  icb.lifesteal_percent, icb.ai_resist_percent
           FROM items i
           LEFT JOIN item_class_bonuses icb
             ON icb.item_id = i.id AND icb.class_id = $2
           WHERE i.id = ANY($1)`,
          [itemIds, player.class_id]
        );

        for (const item of items.rows) {
          totalHp += item.hp_bonus || 0;
          totalAttack += item.attack_bonus || 0;
          totalDefense += item.defense_bonus || 0;
          totalCritChance += Number(item.crit_chance_bonus) || 0;
          totalDodge += Number(item.dodge_bonus) || 0;
          totalLifesteal += Number(item.lifesteal_bonus) || 0;
          totalAiResist += Number(item.ai_resist_bonus) || 0;

          totalHp = Math.floor(totalHp * (1 + Number(item.hp_percent || 0) / 100));
          totalAttack = Math.floor(totalAttack * (1 + Number(item.attack_percent || 0) / 100));
          totalDefense = Math.floor(totalDefense * (1 + Number(item.defense_percent || 0) / 100));
          totalCritChance += Number(item.crit_percent || 0);
          totalDodge += Number(item.dodge_percent || 0);
          totalLifesteal += Number(item.lifesteal_percent || 0);
          totalAiResist += Number(item.ai_resist_percent || 0);
        }
      }
    }

    // Update player stats
    await db.query(
      `UPDATE player_progress 
       SET max_hp = $1, attack = $2, defense = $3,
           crit_chance = $4, dodge = $5, lifesteal = $6, ai_resist = $7,
           updated_at = NOW()
       WHERE id = $8`,
      [totalHp, totalAttack, totalDefense, totalCritChance, totalDodge,
        totalLifesteal, totalAiResist, playerProgressId]
    );
  }
}

export const lootService = new LootService();
