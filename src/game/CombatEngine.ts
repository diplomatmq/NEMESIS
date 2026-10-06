import { PlayerProgress } from '../database/models/PlayerProgress';
import { ActionType, CombatResult } from '../types/game.types';
import { classService } from './ClassService';
import { bossSystem, BossConfig } from './BossSystem';

export interface Enemy {
  id?: number;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  level: number;
  isBoss?: boolean;
  boss_config?: BossConfig;
  turnCount?: number;
}

export class CombatEngine {
  
  async executeCombat(
    player: PlayerProgress,
    enemy: Enemy,
    playerAction: ActionType,
    enemyAction: ActionType,
    playerClassCode?: string
  ): Promise<CombatResult> {
    
    let playerDamage = 0;
    let enemyDamage = 0;
    let isCrit = false;
    let isDodge = false;
    let lifestealHealing = 0;
    let bossHealing = 0;
    let bossAbilityMessage = '';

    // Increment turn count for bosses
    if (enemy.isBoss && enemy.boss_config) {
      enemy.turnCount = (enemy.turnCount || 0) + 1;
    }

    // Check for boss phase transition
    if (enemy.isBoss && enemy.boss_config) {
      const phase = bossSystem.checkPhaseTransition(enemy as any, enemy.hp);
      if (phase) {
        bossAbilityMessage += `\n🔥 ${phase.description}\n`;
        enemy.attack = Math.floor(enemy.attack * phase.damage_bonus);
        enemy.defense = Math.floor(enemy.defense * phase.defense_bonus);
      }
    }

    // For bosses, get action from boss system
    let bossAbility;
    if (enemy.isBoss && enemy.boss_config) {
      const bossAction = bossSystem.selectBossAction(
        enemy as any,
        enemy.hp,
        playerAction,
        enemy.turnCount || 1
      );
      enemyAction = bossAction.action;
      bossAbility = bossAction.ability;
      if (bossAction.message) {
        bossAbilityMessage += bossAction.message + '\n';
      }
    }

    // Calculate player damage
    if (playerAction === ActionType.ATTACK) {
      playerDamage = Math.max(1, player.attack - Math.floor(enemy.defense / 2));
      
      // Apply class passive bonus
      if (playerClassCode) {
        playerDamage = classService.applyClassPassive(
          playerClassCode,
          playerDamage,
          player.hp,
          player.max_hp
        );
      }

      // Check boss weakness
      if (enemy.isBoss && enemy.boss_config && enemy.boss_config.weakness === playerClassCode) {
        playerDamage = Math.floor(playerDamage * 1.3);
        bossAbilityMessage += `💪 Босс слаб против вашего класса! +30% урона\n`;
      }

      // Check boss resistance
      if (enemy.isBoss && enemy.boss_config && enemy.boss_config.resistance === playerClassCode) {
        playerDamage = Math.floor(playerDamage * 0.7);
        bossAbilityMessage += `🛡️ Босс устойчив к вашему классу! -30% урона\n`;
      }

      // Crit chance (varies by class)
      const critChance = playerClassCode ? classService.getClassCritBonus(playerClassCode) : 0.1;
      if (Math.random() < critChance) {
        playerDamage = Math.floor(playerDamage * 1.5);
        isCrit = true;
      }

      // Lifesteal (for Vampire class)
      if (playerClassCode) {
        const lifestealRate = classService.getClassLifesteal(playerClassCode);
        if (lifestealRate > 0) {
          lifestealHealing = Math.floor(playerDamage * lifestealRate);
        }
      }
    }

    // Calculate enemy damage with boss abilities
    if (enemyAction === ActionType.ATTACK) {
      let baseEnemyAttack = enemy.attack;
      let baseEnemyDefense = enemy.defense;

      // Apply boss ability modifiers
      if (enemy.isBoss && bossAbility) {
        const modifiers = bossSystem.applyBossAbilityModifiers(
          baseEnemyAttack,
          baseEnemyDefense,
          bossAbility
        );
        baseEnemyAttack = modifiers.damage;
        baseEnemyDefense = modifiers.defense;
      }

      if (playerAction === ActionType.DEFEND) {
        // Player is defending, reduce damage
        enemyDamage = Math.max(1, Math.floor((baseEnemyAttack - player.defense) * 0.5));
      } else {
        enemyDamage = Math.max(1, baseEnemyAttack - Math.floor(player.defense / 2));
      }

      // Apply class defensive passive (Guardian)
      if (playerClassCode) {
        enemyDamage = classService.calculateClassDefenseBonus(playerClassCode, enemyDamage);
      }

      // Random dodge chance (5%)
      if (Math.random() < 0.05) {
        enemyDamage = 0;
        isDodge = true;
      }

      // Calculate boss healing from life drain
      if (enemy.isBoss && bossAbility && bossAbility.heal_amount && enemyDamage > 0) {
        bossHealing = bossSystem.calculateBossHealing(enemy as any, bossAbility, enemyDamage);
      }
    } else if (enemyAction === ActionType.DEFEND && enemy.isBoss && bossAbility) {
      // Boss healing ability
      bossHealing = bossSystem.calculateBossHealing(enemy as any, bossAbility);
    }

    // Apply damage
    let newEnemyHp = Math.max(0, enemy.hp - playerDamage);
    let newPlayerHp = Math.max(0, player.hp - enemyDamage);

    // Apply lifesteal healing
    if (lifestealHealing > 0) {
      newPlayerHp = Math.min(player.max_hp, newPlayerHp + lifestealHealing);
    }

    // Apply boss healing
    if (bossHealing > 0) {
      newEnemyHp = Math.min(enemy.maxHp, newEnemyHp + bossHealing);
    }

    const enemyDefeated = newEnemyHp <= 0;
    const playerDefeated = newPlayerHp <= 0;

    // Generate combat message
    let message = bossAbilityMessage + this.generateCombatMessage(
      playerAction,
      enemyAction,
      playerDamage,
      enemyDamage,
      isCrit,
      isDodge,
      enemy.name,
      newEnemyHp,
      enemy.maxHp,
      newPlayerHp,
      player.max_hp,
      enemyDefeated,
      playerDefeated,
      lifestealHealing,
      bossHealing
    );

    return {
      success: !playerDefeated,
      playerDamage,
      enemyDamage,
      playerHp: newPlayerHp,
      enemyHp: newEnemyHp,
      isCrit,
      isDodge,
      message,
      enemyDefeated,
      playerDefeated,
      xpGained: enemyDefeated ? enemy.level * 10 : 0,
    };
  }

  private generateCombatMessage(
    playerAction: ActionType,
    enemyAction: ActionType,
    playerDamage: number,
    enemyDamage: number,
    isCrit: boolean,
    isDodge: boolean,
    enemyName: string,
    enemyHp: number,
    enemyMaxHp: number,
    playerHp: number,
    playerMaxHp: number,
    enemyDefeated: boolean,
    playerDefeated: boolean,
    lifestealHealing?: number,
    bossHealing?: number
  ): string {
    let msg = '';

    // Player action
    if (playerAction === ActionType.ATTACK) {
      msg += `⚔️ Вы атакуете!\n`;
      if (isCrit) {
        msg += `💥 КРИТИЧЕСКИЙ УДАР!\n`;
      }
      msg += `🗡️ ${enemyName} получает ${playerDamage} урона.\n`;
      if (lifestealHealing && lifestealHealing > 0) {
        msg += `🩸 Вы восстанавливаете ${lifestealHealing} HP!\n`;
      }
      msg += '\n';
    } else if (playerAction === ActionType.DEFEND) {
      msg += `🛡️ Вы защищаетесь!\n\n`;
    }

    // Enemy action
    if (!enemyDefeated) {
      if (enemyAction === ActionType.ATTACK) {
        if (isDodge) {
          msg += `⚡ Вы уклоняетесь от атаки!\n`;
        } else {
          msg += `👹 ${enemyName} атакует!\n`;
          msg += `💔 Вы получаете ${enemyDamage} урона.\n`;
        }
      } else if (enemyAction === ActionType.DEFEND) {
        msg += `🛡️ ${enemyName} защищается!\n`;
        if (bossHealing && bossHealing > 0) {
          msg += `💚 ${enemyName} восстанавливает ${bossHealing} HP!\n`;
        }
      }
      msg += '\n';
    }

    // Status
    if (enemyDefeated) {
      msg += `✅ ${enemyName} повержен!\n\n`;
    } else {
      msg += `👹 HP противника: ${enemyHp}/${enemyMaxHp}\n`;
    }

    if (playerDefeated) {
      msg += `❌ Вы погибли!\n`;
    } else {
      msg += `❤️ Ваше HP: ${playerHp}/${playerMaxHp}\n`;
    }

    return msg;
  }

  generateEnemy(floor: number): Enemy {
    const level = Math.floor(floor / 10) + 1;
    const isBoss = floor % 10 === 0;
    
    if (isBoss) {
      // Generate boss using boss system
      return bossSystem.generateBossEnemy(floor);
    }
    
    // Regular enemy
    const baseHp = 50 + (level * 20);
    const baseAttack = 8 + (level * 3);
    const baseDefense = 3 + (level * 2);
    
    const enemyTypes = [
      'Страж', 'Демон', 'Голем', 'Химера', 'Драконид', 
      'Скелет-воин', 'Теневой убийца', 'Каменный титан',
      'Огненный элементаль', 'Ледяной элементаль', 'Орк-берсерк',
      'Тёмный рыцарь', 'Некромант', 'Вампир лорд'
    ];
    
    const randomName = enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
    const name = `${randomName} ${level} ур.`;

    return {
      name,
      hp: baseHp,
      maxHp: baseHp,
      attack: baseAttack,
      defense: baseDefense,
      level,
      isBoss: false,
    };
  }
}

export const combatEngine = new CombatEngine();
