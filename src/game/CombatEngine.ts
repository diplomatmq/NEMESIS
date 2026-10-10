import { PlayerProgress } from '../database/models/PlayerProgress';
import { ActionType, CombatResult } from '../types/game.types';
import { classService } from './ClassService';
import { bossSystem, BossConfig } from './BossSystem';
import { SeededRandom } from './SeededRandom';
import { formatBossHealthBar, formatHealthBar, formatMobHealthBar } from './HealthBar';

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
  summonedSupport?: 'mobs' | 'boss';
  summonedSupportName?: string;
}

const MOB_ZONES: Array<[string, string, string]> = [
  ['Пещерный гоблин', 'Слабый скелет', 'Крысиный разведчик'],
  ['Каменный голем', 'Пещерный паук', 'Разбойник тоннелей'],
  ['Орк-воин', 'Гоблин-шаман', 'Боевой кабан'],
  ['Теневой волк', 'Ночной убийца', 'Призрачная летучая мышь'],
  ['Огненный элементаль', 'Пепельный бес', 'Лавовый жук'],
  ['Ледяной элементаль', 'Морозный волк', 'Снежный призрак'],
  ['Корневой зверь', 'Гнилой друид', 'Лесной охотник'],
  ['Железный страж', 'Механический паук', 'Ржавый голем'],
  ['Громовой ящер', 'Штормовой сокол', 'Искровой бес'],
  ['Ученик бездны', 'Живая книга', 'Магический паразит'],
  ['Песчаный червь', 'Разбойник дюн', 'Миражный шакал'],
  ['Рыцарь пепла', 'Огненный скелет', 'Пепельная гарпия'],
  ['Морская сирена', 'Глубинный краб', 'Утопленник'],
  ['Лабиринтный минотавр', 'Каменный бык', 'Блуждающий фантом'],
  ['Сломанный голем', 'Часовой механизм', 'Хрономант'],
  ['Алый дуэлянт', 'Кровавый культист', 'Лунный волк'],
  ['Костяной маг', 'Могильный рыцарь', 'Мёртвый знаменосец'],
  ['Призрачный матрос', 'Скелет-канонир', 'Туманная сирена'],
  ['Химерный зверь', 'Безликий охотник', 'Щупальце бездны'],
  ['Магмовый червь', 'Вулканический бес', 'Обсидиановый страж'],
  ['Сфинкс-пилигрим', 'Песчаный пророк', 'Забытый страж'],
  ['Чумной монах', 'Гниющий носитель', 'Крыса-мутант'],
  ['Серебряный охотник', 'Лунная гарпия', 'Зверь затмения'],
  ['Осадный орк', 'Каменный разрушитель', 'Таранный зверь'],
  ['Миражный убийца', 'Пустынный фантом', 'Зеркальная змея'],
  ['Морозный лич', 'Ледяной рыцарь', 'Кристальный волк'],
  ['Королевский гоблин', 'Золотой вор', 'Шаман племени'],
  ['Девятиглавый змей', 'Ядовитая гидра', 'Кобра алтаря'],
  ['Стальной самурай', 'Дух клинка', 'Ронин-тень'],
  ['Багровая ведьма', 'Кровавый ворон', 'Проклятый жрец'],
  ['Звёздный паразит', 'Астральная медуза', 'Пожиратель света'],
  ['Титан корней', 'Древесный энт', 'Сердце чащи'],
  ['Зеркальный двойник', 'Отражённый рыцарь', 'Мимик зеркал'],
  ['Ночной граф', 'Алый вампир', 'Замковый упырь'],
  ['Оракул-слепец', 'Глаз пустоты', 'Прорицатель теней'],
  ['Адский кузнец', 'Железный демон', 'Огненный рабочий'],
  ['Миазменный дух', 'Чумной зверь', 'Туманная личинка'],
  ['Пепельный феникс', 'Воскресший воин', 'Жар-птица'],
  ['Кристальный рыцарь', 'Осколочный голем', 'Лучистый паук'],
  ['Охотник на героев', 'Проклятый ведьмак', 'Трофейный зверь'],
  ['Небесный дракон', 'Крылатый лев', 'Грозовой змей'],
  ['Ткач-паразит', 'Нитяная ведьма', 'Кукла судьбы'],
  ['Имперский некромант', 'Костяной легионер', 'Мёртвый знаменосец'],
  ['Живой ураган', 'Грозовой элементаль', 'Молниевый дух'],
  ['Младший архидемон', 'Бездонный пёс', 'Пламенный инкуб'],
  ['Астральный голем', 'Звёздный рыцарь', 'Световой охотник'],
  ['Хаотический зверь', 'Случайный фантом', 'Мутант пустоты'],
  ['Последний страж', 'Вершинный рыцарь', 'Хранитель клятвы'],
  ['Мёртвый апостол', 'Апокалиптический зверь', 'Пожиратель душ'],
];

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
    let classAbilityMessage = '';
    let assassinBackstab = false;
    const necromancerPenalty = player.necro_debuff_games > 0;
    const effectiveAttack = Math.max(
      1,
      player.attack + (player.necro_bonus_games > 0 ? player.necro_attack_bonus : 0) -
        (necromancerPenalty ? Math.floor(player.attack * 0.2) : 0)
    );
    const effectiveDefense = Math.max(
      0,
      player.defense + (player.necro_bonus_games > 0 ? player.necro_defense_bonus : 0) -
        (necromancerPenalty ? Math.floor(player.defense * 0.1) : 0)
    );
    if (enemy.summonedSupport) {
      if (enemy.summonedSupport === 'mobs' && Math.random() < 0.85) {
        classAbilityMessage += '💀 Некромант: три мертвеца прикрыли вас — входящий урон снижен!\n';
      } else if (enemy.summonedSupport === 'boss' && Math.random() < 0.85) {
        classAbilityMessage += `☠️ ${enemy.summonedSupportName || 'Призванный босс'} вмешался и атакует!\n`;
      }
    }

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
      playerDamage = Math.max(1, effectiveAttack - Math.floor(enemy.defense / 2));

      if (playerClassCode === 'assassin') {
        const hpPercent = (player.hp / player.max_hp) * 100;
        const backstabChance = hpPercent < 25 ? 0.65 : 0.4;
        assassinBackstab = Math.random() < backstabChance;
        if (assassinBackstab) {
          playerDamage = Math.max(1, effectiveAttack);
          classAbilityMessage +=
            '🗡 Ассасин: зашёл за спину — ответный удар сорван, защита пробита!\n';
        }
      }
      
      // Apply class passive bonus
      if (playerClassCode) {
        const damageBeforePassive = playerDamage;
        const hasSouls = playerClassCode === 'necromancer' 
          ? (player.necro_mob_souls > 0 || (Array.isArray(player.necro_boss_souls) && player.necro_boss_souls.length > 0))
          : false;
        playerDamage = classService.applyClassPassive(
          playerClassCode,
          playerDamage,
          player.hp,
          player.max_hp,
          hasSouls
        );
        if (playerClassCode === 'berserker' && playerDamage > damageBeforePassive) {
          classAbilityMessage += '🔥 Берсерк: ярость усилила ваш удар!\n';
        } else if (playerClassCode === 'arcanist' && playerDamage > damageBeforePassive) {
          classAbilityMessage += '✨ Арканист: магия пробила защиту!\n';
        } else if (playerClassCode === 'jester' && playerDamage !== damageBeforePassive) {
          const change = playerDamage - damageBeforePassive;
          if (change > 0) {
            classAbilityMessage += `🎲 Шут: удача! Урон увеличен на ${change}!\n`;
          } else if (change < 0) {
            classAbilityMessage += `🎲 Шут: неудача! Урон снижен на ${Math.abs(change)}!\n`;
          }
        } else if (playerClassCode === 'necromancer' && playerDamage > damageBeforePassive && hasSouls) {
          if (Math.random() < 0.85) {
            classAbilityMessage += '☠️ Некромант: мёртвые усилили удар!\n';
          }
        }
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
      const critChance = (player.crit_chance || 0) / 100 +
        (playerClassCode ? classService.getClassCritBonus(playerClassCode) : 0.1);
      if (Math.random() < critChance) {
        playerDamage = Math.floor(playerDamage * 1.5);
        isCrit = true;
        if (playerClassCode === 'assassin') {
          classAbilityMessage += '💥 Ассасин: смертельный критический удар!\n';
        }
      }

      // Lifesteal (for Vampire class)
      if (playerClassCode) {
        const lifestealRate = (player.lifesteal || 0) / 100 +
          classService.getClassLifesteal(playerClassCode);
        if (lifestealRate > 0 && Math.random() < 0.65) {
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

      if (assassinBackstab) {
        enemyDamage = 0;
      } else if (playerAction === ActionType.DEFEND) {
        // Player is defending, reduce damage
        enemyDamage = Math.max(1, Math.floor((baseEnemyAttack - effectiveDefense) * 0.5));
      } else {
        enemyDamage = Math.max(1, baseEnemyAttack - Math.floor(effectiveDefense / 2));
      }
      if (enemy.summonedSupport === 'mobs') {
        enemyDamage = Math.floor(enemyDamage * 0.7);
      } else if (enemy.summonedSupport === 'boss') {
        enemyDamage += Math.max(1, Math.floor(enemy.attack * 0.25));
      }

      // Apply class defensive passive (Guardian)
      if (playerClassCode) {
        const damageBeforePassive = enemyDamage;
        enemyDamage = classService.calculateClassDefenseBonus(playerClassCode, enemyDamage);
        if (playerClassCode === 'guardian' && enemyDamage < damageBeforePassive) {
          classAbilityMessage += '🛡 Страж: защита снизила урон!\n';
        }
      }

      // Equipment and class dodge are percentage values.
      const dodgeChance = Math.min(0.95, 0.05 + (player.dodge || 0) / 100);
      if (Math.random() < dodgeChance) {
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
      if (playerClassCode === 'vampire') {
        classAbilityMessage += `🩸 Вампир: восстановлено ${lifestealHealing} HP!\n`;
      }
    }

    // Apply boss healing
    if (bossHealing > 0) {
      newEnemyHp = Math.min(enemy.maxHp, newEnemyHp + bossHealing);
    }

    const enemyDefeated = newEnemyHp <= 0;
    const playerDefeated = newPlayerHp <= 0;

    // Generate combat message
    let message = bossAbilityMessage + classAbilityMessage + this.generateCombatMessage(
      playerAction,
      enemyAction,
      playerDamage,
      enemyDamage,
      isCrit,
      isDodge,
      enemy.name,
      newEnemyHp,
      enemy.maxHp,
      enemy.isBoss || false,
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
    enemyIsBoss: boolean,
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
      msg += `<tg-emoji emoji-id="5408935401442267103">⚔️</tg-emoji> Вы атакуете!\n`;
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
      const enemyHealthBar = enemyIsBoss
        ? formatBossHealthBar(enemyHp, enemyMaxHp)
        : formatMobHealthBar(enemyHp, enemyMaxHp);
      msg += `👹 HP противника: ${enemyHealthBar}\n`;
    }

    if (playerDefeated) {
      msg += `❌ Вы погибли!\n`;
    } else {
      msg += `Ваше HP: ${formatHealthBar(playerHp, playerMaxHp)}\n`;
    }

    return msg;
  }

  generateEnemyS1(
    floor: number,
    seasonId: number,
    difficultyModifier = 1,
    randomizeName = false
  ): Enemy {
    const level = Math.floor(floor / 10) + 1;
    const isBoss = floor % 10 === 0;
    
    if (isBoss) {
      // Generate boss using boss system with seeded random
      return bossSystem.generateBossEnemy(floor, seasonId);
    }
    
    // Regular enemy with deterministic generation
    const rng = SeededRandom.forFloor(floor, seasonId);
    
    const baseHp = 50 + (level * 20);
    const baseAttack = 8 + (level * 3);
    const baseDefense = 3 + (level * 2);
    
    // Each ten-floor zone has its own three regular mobs. Floor 1-9 uses
    // zone 0; floors 11-19 use zone 1, and so on up to floors 491-499.
    const zoneIndex = Math.min(MOB_ZONES.length - 1, Math.floor((floor - 1) / 10));
    const zone = MOB_ZONES[zoneIndex];
    const randomName = randomizeName
      ? zone[Math.floor(Math.random() * zone.length)]
      : rng.choose(zone);
    const name = `${randomName} ${level} ур.`;

    // Add some variance to stats (±10%) using seeded random
    const hpVariance = rng.nextFloat(0.9, 1.1);
    const attackVariance = rng.nextFloat(0.9, 1.1);
    const defenseVariance = rng.nextFloat(0.9, 1.1);

    return {
      name,
      hp: Math.max(1, Math.floor(baseHp * hpVariance * difficultyModifier)),
      maxHp: Math.max(1, Math.floor(baseHp * hpVariance * difficultyModifier)),
      attack: Math.max(1, Math.floor(baseAttack * attackVariance * difficultyModifier)),
      defense: Math.max(1, Math.floor(baseDefense * defenseVariance * difficultyModifier)),
      level,
      isBoss: false,
    };
  }

  generateEnemy(floor: number, seasonId: number, difficultyModifier = 1): Enemy {
    return this.generateEnemyS1(floor, seasonId, difficultyModifier);
  }
}

export const combatEngine = new CombatEngine();
