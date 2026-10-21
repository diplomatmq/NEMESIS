/**
 * Potion Service
 * Handles health potions and HP restoration mechanics
 */
import { db } from '../database/db';
import { PoolClient } from 'pg';

export interface Potion {
  id: number;
  name: string;
  description: string;
  heal_value: number; // Percentage of max HP when heal_type = 'percentage'
  heal_type: 'flat' | 'percentage';
  rarity: string;
  icon: string;
}

/** Minimal query runner shared by the pool and a transaction client. */
type QueryRunner = { query: (text: string, params?: any[]) => Promise<any> };

export class PotionService {
  /**
   * Use a specific health potion from the inventory.
   *
   * When a transaction client is provided, every read and write happens on it,
   * so the single remaining potion, the HP change and the battle flag are all
   * committed or rolled back together. Callers using the pool directly still
   * get a self-contained operation, but the caller-visible reservation is not
   * atomic with it.
   */
  async usePotionById(
    playerProgressId: number,
    itemId: number,
    client?: PoolClient
  ): Promise<{ success: boolean; message: string; newHp: number; potionUsed?: Potion }> {
    const runner: QueryRunner = client ?? db;

    // Lock the inventory row so two parallel requests cannot both consume the
    // same last potion.
    const inventoryResult = await runner.query(
      `SELECT i.id, i.name, i.description,
              i.potion_heal_value as heal_value,
              i.potion_heal_type as heal_type,
              i.rarity, '🧪' as icon, pi.quantity
       FROM player_inventory pi
       JOIN items i ON pi.item_id = i.id
       WHERE pi.player_progress_id = $1
         AND pi.item_id = $2
         AND i.slot = 'potion'
         AND i.potion_heal_value > 0
       FOR UPDATE OF pi`,
      [playerProgressId, itemId]
    );
    const row = inventoryResult.rows[0];

    if (!row || row.quantity <= 0) {
      const current = await runner.query(
        'SELECT hp FROM player_progress WHERE id = $1',
        [playerProgressId]
      );
      return {
        success: false,
        message: '🧪 Этого зелья нет в инвентаре!',
        newHp: current.rows[0]?.hp ?? 0,
      };
    }

    // Lock the progress row and read the live HP values instead of trusting
    // the copies loaded before the transaction started.
    const progressResult = await runner.query(
      'SELECT hp, max_hp FROM player_progress WHERE id = $1 FOR UPDATE',
      [playerProgressId]
    );
    const currentHp: number = progressResult.rows[0].hp;
    const maxHp: number = progressResult.rows[0].max_hp;

    // Calculate healing
    const healAmount = row.heal_type === 'percentage'
      ? Math.floor(maxHp * row.heal_value / 100)
      : row.heal_value;

    const newHp = Math.min(currentHp + healAmount, maxHp);
    const actualHeal = newHp - currentHp;

    // Remove potion from inventory
    if (row.quantity <= 1) {
      await runner.query(
        'DELETE FROM player_inventory WHERE player_progress_id = $1 AND item_id = $2',
        [playerProgressId, itemId]
      );
    } else {
      await runner.query(
        'UPDATE player_inventory SET quantity = quantity - 1 WHERE player_progress_id = $1 AND item_id = $2',
        [playerProgressId, itemId]
      );
    }

    // Update player HP
    await runner.query(
      'UPDATE player_progress SET hp = $1, updated_at = NOW() WHERE id = $2',
      [newHp, playerProgressId]
    );

    return {
      success: true,
      message: `${row.icon} Вы использовали **${row.name}**\n\n` +
               `💚 Восстановлено: **${actualHeal} HP**\n` +
               `❤️ Текущее HP: **${newHp}/${maxHp}**`,
      newHp,
      potionUsed: {
        id: row.id,
        name: row.name,
        description: row.description,
        heal_value: row.heal_value,
        heal_type: row.heal_type,
        rarity: row.rarity,
        icon: row.icon,
      },
    };
  }

  /**
   * Return the distinct potions the player owns, with how many of each.
   */
  async getPotionChoices(
    playerProgressId: number
  ): Promise<Array<{ itemId: number; name: string; icon: string; heal_value: number; heal_type: 'flat' | 'percentage'; quantity: number }>> {
    const potions = await this.getPlayerPotions(playerProgressId);
    const byItem = new Map<number, { itemId: number; name: string; icon: string; heal_value: number; heal_type: 'flat' | 'percentage'; quantity: number }>();

    for (const potion of potions) {
      const existing = byItem.get(potion.id);
      if (existing) {
        existing.quantity += 1;
      } else {
        byItem.set(potion.id, {
          itemId: potion.id,
          name: potion.name,
          icon: potion.icon,
          heal_value: potion.heal_value,
          heal_type: potion.heal_type,
          quantity: 1,
        });
      }
    }

    // Strongest first so the list is stable and readable
    return Array.from(byItem.values()).sort((a, b) => b.heal_value - a.heal_value);
  }

  /**
   * Get all health potions in player's inventory
   */
  async getPlayerPotions(playerProgressId: number): Promise<Potion[]> {
    const result = await db.query(
      `SELECT i.id, i.name, i.description,
              i.potion_heal_value as heal_value,
              i.potion_heal_type as heal_type,
              i.rarity, '🧪' as icon, pi.quantity
       FROM player_inventory pi
       JOIN items i ON pi.item_id = i.id
       WHERE pi.player_progress_id = $1
       AND i.slot = 'potion'
       AND i.potion_heal_value > 0
       ORDER BY i.potion_heal_value DESC`,
      [playerProgressId]
    );

    // Expand potions based on quantity
    const potions: Potion[] = [];
    for (const row of result.rows) {
      for (let i = 0; i < row.quantity; i++) {
        potions.push({
          id: row.id,
          name: row.name,
          description: row.description,
          heal_value: row.heal_value,
          heal_type: row.heal_type,
          rarity: row.rarity,
          icon: row.icon,
        });
      }
    }

    return potions;
  }

  /**
   * Add health potion to inventory as loot
   */
  async addPotionToInventory(
    playerProgressId: number,
    potionType: 'small' | 'medium' | 'large' = 'small',
    quantity: number = 1
  ): Promise<void> {
    // Get or create potion item
    const potionData = this.getPotionData(potionType);
    
    // Check if potion item exists
    let itemResult = await db.query(
      'SELECT id FROM items WHERE name = $1 AND slot = $2',
      [potionData.name, 'potion']
    );

    let itemId: number;

    if (itemResult.rows.length === 0) {
      // Create potion item
      const createResult = await db.query(
        `INSERT INTO items (name, description, slot, rarity, hp_bonus, potion_heal_type, potion_heal_value)
         VALUES ($1, $2, $3, $4, 0, $5, $6)
         RETURNING id`,
        [potionData.name, potionData.description, 'potion', potionData.rarity,
          potionData.heal_type, potionData.heal_value]
      );
      itemId = createResult.rows[0].id;
    } else {
      itemId = itemResult.rows[0].id;
      // Keep the heal definition in sync with the potion type
      await db.query(
        `UPDATE items
         SET description = $2, potion_heal_type = $3, potion_heal_value = $4
         WHERE id = $1`,
        [itemId, potionData.description, potionData.heal_type, potionData.heal_value]
      );
    }

    // Add to inventory or update quantity
    const existingResult = await db.query(
      'SELECT id, quantity FROM player_inventory WHERE player_progress_id = $1 AND item_id = $2',
      [playerProgressId, itemId]
    );

    if (existingResult.rows.length > 0) {
      // Update quantity
      await db.query(
        'UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2',
        [quantity, existingResult.rows[0].id]
      );
    } else {
      // Insert new
      await db.query(
        'INSERT INTO player_inventory (player_progress_id, item_id, quantity) VALUES ($1, $2, $3)',
        [playerProgressId, itemId, quantity]
      );
    }
  }

  /**
   * Get potion data by type
   */
  private getPotionData(type: 'small' | 'medium' | 'large'): {
    name: string;
    description: string;
    heal_type: 'percentage';
    heal_value: number;
    rarity: string;
  } {
    switch (type) {
      case 'small':
        return {
          name: 'Малое зелье здоровья',
          description: 'Восстанавливает 20% HP',
          heal_type: 'percentage',
          heal_value: 20,
          rarity: 'common',
        };
      case 'medium':
        return {
          name: 'Зелье здоровья',
          description: 'Восстанавливает 30% HP',
          heal_type: 'percentage',
          heal_value: 30,
          rarity: 'uncommon',
        };
      case 'large':
        return {
          name: 'Большое зелье здоровья',
          description: 'Восстанавливает 40% HP',
          heal_type: 'percentage',
          heal_value: 40,
          rarity: 'rare',
        };
    }
  }

  /**
   * Heal player on floor completion (full HP restore)
   */
  async healOnFloorCompletion(playerProgressId: number, maxHp: number): Promise<void> {
    await db.query(
      'UPDATE player_progress SET hp = $1, updated_at = NOW() WHERE id = $2',
      [maxHp, playerProgressId]
    );
  }

  /**
   * Check if player needs healing
   */
  isLowHealth(currentHp: number, maxHp: number, threshold: number = 0.3): boolean {
    return (currentHp / maxHp) <= threshold;
  }
}

export const potionService = new PotionService();
