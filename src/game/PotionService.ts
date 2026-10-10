/**
 * Potion Service
 * Handles health potions and HP restoration mechanics
 */
import { db } from '../database/db';

export interface Potion {
  id: number;
  name: string;
  description: string;
  heal_amount: number; // Flat amount or percentage if < 1
  heal_type: 'flat' | 'percentage';
  rarity: string;
  icon: string;
}

export class PotionService {
  /**
   * Use a health potion from inventory
   */
  async usePotion(
    playerProgressId: number,
    currentHp: number,
    maxHp: number
  ): Promise<{ success: boolean; message: string; newHp: number; potionUsed?: Potion }> {
    // Check if player has any health potions
    const potions = await this.getPlayerPotions(playerProgressId);
    
    if (potions.length === 0) {
      return {
        success: false,
        message: '🧪 У вас нет зелий здоровья!\n\n💡 Зелья можно получить из добычи или купить у торговцев.',
        newHp: currentHp,
      };
    }

    // Use the first available potion
    const potion = potions[0];
    
    // Calculate healing
    let healAmount = 0;
    if (potion.heal_type === 'percentage') {
      healAmount = Math.floor(maxHp * potion.heal_amount);
    } else {
      healAmount = potion.heal_amount;
    }

    const newHp = Math.min(currentHp + healAmount, maxHp);
    const actualHeal = newHp - currentHp;

    // Remove potion from inventory
    await this.removePotion(playerProgressId, potion.id);

    // Update player HP
    await db.query(
      'UPDATE player_progress SET hp = $1, updated_at = NOW() WHERE id = $2',
      [newHp, playerProgressId]
    );

    return {
      success: true,
      message: `${potion.icon} Вы использовали **${potion.name}**\n\n` +
               `💚 Восстановлено: **${actualHeal} HP**\n` +
               `❤️ Текущее HP: **${newHp}/${maxHp}**`,
      newHp,
      potionUsed: potion,
    };
  }

  /**
   * Get all health potions in player's inventory
   */
  async getPlayerPotions(playerProgressId: number): Promise<Potion[]> {
    const result = await db.query(
      `SELECT i.id, i.name, i.description, i.hp_bonus as heal_amount, 
              CASE WHEN i.hp_bonus <= 1 THEN 'percentage' ELSE 'flat' END as heal_type,
              i.rarity, '🧪' as icon, pi.quantity
       FROM player_inventory pi
       JOIN items i ON pi.item_id = i.id
       WHERE pi.player_progress_id = $1 
       AND i.slot = 'potion'
       AND i.hp_bonus > 0
       ORDER BY i.hp_bonus DESC`,
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
          heal_amount: row.heal_amount,
          heal_type: row.heal_type,
          rarity: row.rarity,
          icon: row.icon,
        });
      }
    }

    return potions;
  }

  /**
   * Remove one potion from inventory
   */
  async removePotion(playerProgressId: number, itemId: number): Promise<void> {
    // Decrease quantity by 1
    const result = await db.query(
      `UPDATE player_inventory 
       SET quantity = quantity - 1
       WHERE player_progress_id = $1 AND item_id = $2
       RETURNING quantity`,
      [playerProgressId, itemId]
    );

    // If quantity is 0, delete the row
    if (result.rows[0] && result.rows[0].quantity <= 0) {
      await db.query(
        'DELETE FROM player_inventory WHERE player_progress_id = $1 AND item_id = $2',
        [playerProgressId, itemId]
      );
    }
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
        `INSERT INTO items (name, description, slot, rarity, hp_bonus)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [potionData.name, potionData.description, 'potion', potionData.rarity, potionData.heal_amount]
      );
      itemId = createResult.rows[0].id;
    } else {
      itemId = itemResult.rows[0].id;
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
    heal_amount: number;
    rarity: string;
  } {
    switch (type) {
      case 'small':
        return {
          name: 'Малое зелье здоровья',
          description: 'Восстанавливает 30 HP',
          heal_amount: 30,
          rarity: 'common',
        };
      case 'medium':
        return {
          name: 'Зелье здоровья',
          description: 'Восстанавливает 50% HP',
          heal_amount: 50, // Целое число (процент)
          rarity: 'uncommon',
        };
      case 'large':
        return {
          name: 'Большое зелье здоровья',
          description: 'Полностью восстанавливает HP',
          heal_amount: 100, // Целое число (процент)
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
