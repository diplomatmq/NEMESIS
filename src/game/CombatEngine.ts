import { PlayerProgress } from '../database/models/PlayerProgress';
import { ActionType, CombatResult } from '../types/game.types';
import { classService } from './ClassService';
import { bossSystem, BossConfig, HEAL_INTERVAL_TURNS, HEAL_TOTAL_FRACTION } from './BossSystem';
import { SeededRandom } from './SeededRandom';
import { formatBossHealthBar, formatHealthBar, formatMobHealthBar } from './HealthBar';
import { specialEffects, EffectContext, IncomingEffectReport } from './SpecialEffects';

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
  totalHealingReceived?: number; // Track total healing for boss heal cap
  lastHealTurn?: number; // Track when boss last healed for cooldown
  storedDefenseBonus?: number; // Store defense bonus for next attack
  abilityCooldowns?: Record<string, number>; // Turn number when a boss ability was last used
  potionUsed?: boolean; // Limit to one potion per combat
  guardianHealTotal?: number; // Track guardian defense healing per combat
  effectUsedOnce?: string[]; // Equipment effects that already fired in this combat
}

/** Equipment and class damage reduction can never exceed this value. */
const MAX_DEFENSE_REDUCTION = 0.75;

/** Baseline charge a DEFEND action grants to the next attack. */
const DEFENSE_BASE_BONUS = 0.10;

/** The stored charge can never exceed this share of the effective attack. */
const MAX_STORED_DEFENSE_BONUS = 0.30;


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
    playerClassCode?: string,
    predictedEnemyAction?: ActionType
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
    let reflectedDamage = 0;
    let counterAttackDamage = 0;
    let defenseHealing = 0;
    let nextAttackBonus = 0;
    let attackHeal = 0;
    let defenseDodgeBonus = 0;
    let incomingReport: IncomingEffectReport | undefined;
    
    // Initialize boss healing tracking
    if (enemy.isBoss && enemy.totalHealingReceived === undefined) {
      enemy.totalHealingReceived = 0;
      enemy.lastHealTurn = 0;
    }
    
    // Defense bonus stored on a previous turn is spent only on the next
    // ATTACK. It is read here but consumed inside the attack branch, so
    // defending again or using other actions never wastes it.
    const storedAttackBonus = enemy.storedDefenseBonus && enemy.storedDefenseBonus > 0
      ? enemy.storedDefenseBonus
      : 0;

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
    
    // Necromancer minion support notifications (defensive)
    if (enemy.summonedSupport && enemyAction === ActionType.ATTACK) {
      if (enemy.summonedSupport === 'mobs' && Math.random() < 0.85) {
        classAbilityMessage += '💀 Некромант: три мертвеца прикрыли вас — входящий урон снижен!\n';
      } else if (enemy.summonedSupport === 'boss' && Math.random() < 0.85) {
        classAbilityMessage += `☠️ ${enemy.summonedSupportName || 'Призванный босс'} прикрывает вас от атаки!\n`;
      }
    }

    // The turn counter drives first-strike effects as well as boss cooldowns,
    // so it must advance for every enemy, not only bosses. Otherwise
    // turnCount stays at 1 for regular enemies and first-hit relics fire on
    // every incoming hit.
    enemy.turnCount = (enemy.turnCount || 0) + 1;

    // Check for boss phase transition
    if (enemy.isBoss && enemy.boss_config) {
      const phase = bossSystem.checkPhaseTransition(enemy as any, enemy.hp);
      if (phase) {
        bossAbilityMessage += `\n🔥 ${phase.description}\n`;
        enemy.attack = Math.floor(enemy.attack * phase.damage_bonus);
        enemy.defense = Math.floor(enemy.defense * phase.defense_bonus);
      }
    }

    // For bosses, get action from boss system. The Tactician's forecast is
    // passed in so it can bias the choice towards the predicted action.
    let bossAbility;
    if (enemy.isBoss && enemy.boss_config) {
      const bossAction = bossSystem.selectBossAction(
        enemy as any,
        enemy.hp,
        playerAction,
        enemy.turnCount || 1,
        predictedEnemyAction
      );
      enemyAction = bossAction.action;
      bossAbility = bossAction.ability;
      if (bossAction.message) {
        bossAbilityMessage += bossAction.message + '\n';
      }
    }

    // The forecast only counts when the enemy really performs that action.
    const predictionCorrect =
      predictedEnemyAction !== undefined && enemyAction === predictedEnemyAction;

    if (!enemy.effectUsedOnce) {
      enemy.effectUsedOnce = [];
    }
    const usedOnce = enemy.effectUsedOnce;
    const effectContext = (overrides: Partial<EffectContext> = {}): EffectContext => ({
      effects: Array.isArray(player.equipment_effects) ? player.equipment_effects : [],
      playerHp: player.hp,
      playerMaxHp: player.max_hp,
      enemyHp: enemy.hp,
      enemyMaxHp: enemy.maxHp,
      isBoss: enemy.isBoss || false,
      playerAction,
      enemyAction,
      isCrit: false,
      predictionCorrect,
      hasMinion: enemy.summonedSupport === 'mobs' || enemy.summonedSupport === 'boss',
      turnCount: enemy.turnCount || 1,
      usedOnce,
      ...overrides,
    });

    // Void shields and similar relics can fully suppress an announced ability.
    if (bossAbility) {
      const nullify = specialEffects.tryNullifyAbility(effectContext({ isBoss: true }));
      if (nullify.nullified) {
        bossAbilityMessage += nullify.message;
        bossAbility = undefined;
      }
    }

    // Calculate player damage
    if (playerAction === ActionType.ATTACK) {
      // Spend the defense bonus stored on a previous turn on this attack only.
      const attackPower = effectiveAttack + storedAttackBonus;
      if (storedAttackBonus > 0) {
        classAbilityMessage += `✨ Защита прошлого хода усиливает атаку на +${storedAttackBonus}!\n`;
        enemy.storedDefenseBonus = 0;
      }

      // Defensive stance and similar abilities boost the boss defense that
      // reduces the player's attack this turn.
      const bossDefenseForAttack =
        enemy.isBoss && bossAbility?.defense_multiplier
          ? Math.floor(enemy.defense * bossAbility.defense_multiplier)
          : enemy.defense;

      // Equipment effects that scale with a critical hit share the same roll
      // as the crit itself, so both use one outcome.
      const preCritEffects = specialEffects.analyzeAttack(effectContext({ isCrit: false }));
      const critChance = (player.crit_chance || 0) / 100 +
        (playerClassCode ? classService.getClassCritBonus(playerClassCode) : 0.1) +
        preCritEffects.critChanceBonus / 100;
      const willCrit = Math.random() < critChance;
      const attackEffects = willCrit
        ? specialEffects.analyzeAttack(effectContext({ isCrit: true }))
        : preCritEffects;
      if (attackEffects.messages.length > 0) {
        classAbilityMessage += attackEffects.messages.join('\n') + '\n';
      }
      if (attackEffects.healPercent > 0) {
        attackHeal = Math.floor(player.max_hp * attackEffects.healPercent);
      }

      // Base damage after armor penetration. Equipment can pierce part of the
      // enemy defense before it is halved.
      const defensePortion = Math.max(0, Math.floor(
        Math.floor(bossDefenseForAttack / 2) * (1 - attackEffects.defensePierce)
      ));
      playerDamage = Math.max(1, attackPower - defensePortion);

      // Assassin Backstab (penerates defense completely)
      if (playerClassCode === 'assassin') {
        const hpPercent = (player.hp / player.max_hp) * 100;
        const backstabChance = hpPercent < 25 ? 0.65 : 0.4;
        assassinBackstab = Math.random() < backstabChance;
        if (assassinBackstab) {
          playerDamage = Math.max(1, attackPower); // Full attack, ignore defense
          classAbilityMessage +=
            '🗡 Ассасин: зашёл за спину — ответный удар сорван, защита пробита!\n';
        }
      }
      
      // Apply class passive bonus (ONCE)
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
        
        // Message only if damage changed
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

      // Check boss weakness/resistance
      if (enemy.isBoss && enemy.boss_config) {
        if (enemy.boss_config.weakness === playerClassCode) {
          playerDamage = Math.floor(playerDamage * 1.2);
          bossAbilityMessage += `💪 Босс слаб против вашего класса! +20% урона\n`;
        } else if (enemy.boss_config.resistance === playerClassCode) {
          playerDamage = Math.floor(playerDamage * 0.7);
          bossAbilityMessage += `🛡️ Босс устойчив к вашему классу! -30% урона\n`;
        }
      }

      // Equipment damage multiplier (rage, executioner, prediction relics...)
      if (attackEffects.damageMultiplier !== 1) {
        playerDamage = Math.max(1, Math.floor(playerDamage * attackEffects.damageMultiplier));
      }

      // Critical hit (applied ONCE at the end of damage calculation)
      if (willCrit) {
        playerDamage = Math.floor(playerDamage * 1.5);
        isCrit = true;
        if (playerClassCode === 'assassin') {
          classAbilityMessage += '💥 Ассасин: смертельный критический удар!\n';
        }
      }

      // Lifesteal (calculated from FINAL damage dealt, applied later)
      if (playerClassCode) {
        const lifestealRate = (player.lifesteal || 0) / 100 +
          classService.getClassLifesteal(playerClassCode) +
          attackEffects.lifestealBonus;
        if (lifestealRate > 0 && Math.random() < 0.65) {
          lifestealHealing = Math.floor(playerDamage * lifestealRate);
        }
      }
      
      // Necromancer summoned boss adds damage to player's attack
      if (playerClassCode === 'necromancer' && enemy.summonedSupport === 'boss') {
        const summonedBossDamage = Math.max(1, Math.floor(attackPower * 0.20));
        playerDamage += summonedBossDamage;
        classAbilityMessage += `☠️ Призванный босс: +${summonedBossDamage} урона!\n`;
      }
    }

    // Enemy strike preparation. Defensive stances need the same numbers for
    // reflection and counter-attacks, so they are computed up front even when
    // the enemy chooses not to attack this turn.
    const enemyAttacked = enemyAction === ActionType.ATTACK;
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

    let damageReduction = 0;
    let fullBlock = false;

    // Assassin Backstab negates enemy attack completely
    if (assassinBackstab) {
      enemyDamage = 0;
    } else if (playerAction === ActionType.DEFEND) {
      // A guard always charges the next strike. The baseline is 10% of the
      // effective attack and the class stance extends it on top, so a boss
      // that skips its attack does not waste the player's stance.
      nextAttackBonus = Math.floor(effectiveAttack * DEFENSE_BASE_BONUS);

      switch (playerClassCode) {
        case 'berserker': {
          // 35% reduction (45% if HP < 30%)
          const hpPercent = (player.hp / player.max_hp) * 100;
          damageReduction = hpPercent < 30 ? 0.45 : 0.35;
          const reductionPercent = Math.floor(damageReduction * 100);
          classAbilityMessage += `⚔️ Берсерк: ярость боли поглотила ${reductionPercent}% урона!\n`;
          nextAttackBonus += Math.floor(effectiveAttack * 0.15);
          break;
        }

        case 'guardian': {
          // 50% reduction + 2% max HP heal (capped at 10% max HP per combat)
          damageReduction = 0.50;
          const healCap = Math.floor(player.max_hp * 0.10);
          const usedHeal = enemy.guardianHealTotal || 0;
          const healAmount = Math.floor(player.max_hp * 0.02);
          defenseHealing = Math.max(0, Math.min(healAmount, healCap - usedHeal));
          enemy.guardianHealTotal = usedHeal + defenseHealing;
          classAbilityMessage += `🛡 Страж: крепость поглотила 50% урона! Восстановлено ${defenseHealing} HP!\n`;
          nextAttackBonus += Math.floor(effectiveAttack * 0.05);
          break;
        }

        case 'assassin': {
          // The shadow dodge and its counter need a strike to evade, so they
          // stay inert when the enemy holds its ground.
          if (enemyAttacked && Math.random() < 0.40) {
            fullBlock = true;
            counterAttackDamage = Math.floor(effectiveAttack * 0.50);
            classAbilityMessage += `🗡 Ассасин: теневое уклонение! Контратака на ${counterAttackDamage} урона!\n`;
          } else {
            damageReduction = 0.40;
            if (enemyAttacked) {
              classAbilityMessage += `🗡 Ассасин: частичное уклонение! Урон снижен на 40%!\n`;
            }
          }
          nextAttackBonus += Math.floor(effectiveAttack * 0.20);
          break;
        }

        case 'vampire': {
          // 35% reduction + reflect 15% of prevented + heal 15% of reflected
          damageReduction = 0.35;
          if (enemyAttacked) {
            const prevented = Math.floor(baseEnemyAttack * damageReduction);
            reflectedDamage = Math.floor(prevented * 0.15);
            defenseHealing = Math.floor(reflectedDamage * 0.15);
            classAbilityMessage += `🩸 Вампир: кровавое возмездие! Отражено ${reflectedDamage} урона, восстановлено ${defenseHealing} HP!\n`;
          }
          nextAttackBonus += Math.floor(effectiveAttack * 0.15);
          break;
        }

        case 'arcanist': {
          // 45% reduction + energy stored as attack bonus. Energy only comes
          // from damage the barrier actually absorbs.
          damageReduction = 0.45;
          if (enemyAttacked) {
            const prevented = Math.floor(baseEnemyAttack * damageReduction);
            const energyPercent = Math.min(25, Math.floor(prevented * 0.20));
            const energyBonus = Math.floor(effectiveAttack * (energyPercent / 100));
            nextAttackBonus += energyBonus;
            classAbilityMessage += `🧙 Арканист: магический барьер поглотил 45% урона! +${energyBonus} к следующей атаке!\n`;
          }
          break;
        }

        case 'tactician': {
          // The class reads the enemy intent: only a correct forecast pays
          // off, a missed one leaves the baseline stance.
          if (predictionCorrect) {
            damageReduction = 0.50;
            const bonus = Math.floor(effectiveAttack * 0.20);
            nextAttackBonus += bonus;
            classAbilityMessage += `🧠 Тактик: предугадал действие! Урон снижен на 50%, +${bonus} к следующей атаке!\n`;
          } else {
            damageReduction = 0.30;
            classAbilityMessage += `🧠 Тактик: прогноз не сбылся, урон снижен на 30%.\n`;
          }
          break;
        }

        case 'jester': {
          // Random effects: 20% full dodge, 30% mirror (35% + reflect),
          // 50% swap (40%). All of them need an incoming strike.
          if (enemyAttacked) {
            const roll = Math.random();
            if (roll < 0.20) {
              fullBlock = true;
              classAbilityMessage += `🃏 Шут: фокус! Полное уклонение!\n`;
            } else if (roll < 0.50) {
              damageReduction = 0.35;
              const prevented = Math.floor(baseEnemyAttack * damageReduction);
              reflectedDamage = Math.floor(prevented * 0.20);
              classAbilityMessage += `🃏 Шут: зеркало! Урон снижен на 35%, отражено ${reflectedDamage}!\n`;
            } else {
              damageReduction = 0.40;
              classAbilityMessage += `🃏 Шут: подмена! Урон снижен на 40%!\n`;
            }
          } else {
            damageReduction = 0.40;
          }
          nextAttackBonus += Math.floor(effectiveAttack * 0.15);
          break;
        }

        case 'necromancer': {
          // 50% if minion active, 40% if no minion
          const hasMinion = enemy.summonedSupport === 'mobs' || enemy.summonedSupport === 'boss';
          damageReduction = hasMinion ? 0.50 : 0.40;
          const reductionPercent = Math.floor(damageReduction * 100);
          if (hasMinion) {
            classAbilityMessage += `☠️ Некромант: миньон поглотил ${reductionPercent}% урона!\n`;
          } else {
            classAbilityMessage += `☠️ Некромант: призрачный щит поглотил ${reductionPercent}% урона!\n`;
          }
          nextAttackBonus += Math.floor(effectiveAttack * 0.15);
          break;
        }

        default: {
          // Default 40% reduction for undefined classes
          damageReduction = 0.40;
          break;
        }
      }

      // Equipment effects on defence (shields, plates, reflect relics...)
      const defenseEffects = specialEffects.analyzeDefense(effectContext(), predictionCorrect);
      if (defenseEffects.messages.length > 0) {
        classAbilityMessage += defenseEffects.messages.join('\n') + '\n';
      }
      damageReduction = Math.min(
        MAX_DEFENSE_REDUCTION,
        damageReduction + defenseEffects.damageReduction
      );
      nextAttackBonus += Math.floor(effectiveAttack * defenseEffects.nextAttackBonusPercent);
      defenseDodgeBonus = defenseEffects.dodgeBonus;
      if (defenseEffects.healPercent > 0) {
        defenseHealing += Math.floor(player.max_hp * defenseEffects.healPercent);
      }
      if (enemyAttacked) {
        if (defenseEffects.reflectPercent > 0) {
          reflectedDamage += Math.floor(baseEnemyAttack * defenseEffects.reflectPercent);
        }
        if (Math.random() < defenseEffects.blockChance
          || Math.random() < defenseEffects.fullBlockChance) {
          fullBlock = true;
          classAbilityMessage += '🛡 Экипировка полностью заблокировала удар!\n';
        }
      }
    }

    if (enemyAttacked) {
      if (!assassinBackstab && playerAction !== ActionType.DEFEND) {
        // Normal attack - armor reduces damage but can never absorb more than
        // 40% of the base hit, no matter how high defense is.
        const armorReduction = Math.min(
          Math.floor(effectiveDefense * 0.35),
          Math.floor(baseEnemyAttack * 0.40)
        );
        damageReduction = baseEnemyAttack > 0 ? armorReduction / baseEnemyAttack : 0;
      }

      // Necromancer minion support feeds the same reduction pool.
      if (enemy.summonedSupport === 'mobs') {
        damageReduction += 0.30;
      } else if (enemy.summonedSupport === 'boss') {
        damageReduction += 0.15;
      }

      // First-strike and concealment relics add dodge no matter which action
      // the player chose.
      const firstStrike = specialEffects.analyzeIncomingDodge(effectContext());

      // Dodge chance (equipment-based, capped at 95%)
      const dodgeChance = Math.min(
        0.95,
        0.05 + (player.dodge || 0) / 100 + defenseDodgeBonus + firstStrike.dodgeBonus
      );
      if (Math.random() < dodgeChance) {
        fullBlock = true;
        isDodge = true;
        if (firstStrike.messages.length > 0) {
          classAbilityMessage += firstStrike.messages.join('\n') + '\n';
        }
        const dodgeEffects = specialEffects.onDodge(effectContext());
        if (dodgeEffects.messages.length > 0) {
          classAbilityMessage += dodgeEffects.messages.join('\n') + '\n';
        }
        if (dodgeEffects.healPercent > 0) {
          defenseHealing += Math.floor(player.max_hp * dodgeEffects.healPercent);
        }
        nextAttackBonus += Math.floor(effectiveAttack * dodgeEffects.nextAttackBonusPercent);
      }

      // Equipment reactions to an incoming hit (shields, last-chance relics).
      if (!fullBlock) {
        incomingReport = specialEffects.analyzeIncoming(effectContext(), baseEnemyAttack);
        if (incomingReport.messages.length > 0) {
          classAbilityMessage += incomingReport.messages.join('\n') + '\n';
        }
        damageReduction += incomingReport.reduction;
      }

      // Apply every percentage reduction once, under one shared cap. A real
      // full block leaves zero damage instead of the usual minimum of one.
      if (fullBlock) {
        enemyDamage = 0;
      } else {
        const cappedReduction = Math.min(MAX_DEFENSE_REDUCTION, Math.max(0, damageReduction));
        const afterReduction = Math.floor(baseEnemyAttack * (1 - cappedReduction));
        const absorbed = incomingReport?.absorbFlat || 0;
        // A shield that covers the whole remaining hit leaves zero damage; the
        // minimum of one only applies when damage still gets through.
        enemyDamage = absorbed >= afterReduction ? 0 : Math.max(1, afterReduction - absorbed);
      }

      // Boss healing from life drain. It shares the same interval and total
      // cap as dedicated heal abilities, so drain attacks cannot be stacked
      // with them more often than the interval allows.
      if (enemy.isBoss && bossAbility && bossAbility.heal_amount && enemyDamage > 0) {
        const currentTurn = enemy.turnCount || 1;
        if (currentTurn - (enemy.lastHealTurn || 0) >= HEAL_INTERVAL_TURNS) {
          bossHealing = bossSystem.calculateBossHealing(enemy as any, bossAbility, enemyDamage);
          if (bossHealing > 0) {
            enemy.lastHealTurn = currentTurn;
          }
        }
      }
    } else if (enemyAction === ActionType.DEFEND && enemy.isBoss && bossAbility?.heal_amount) {
      // Boss defensive healing. Its limits are shared with BossSystem via the
      // HEAL_* constants, but are re-checked here as a safety net.
      const currentTurn = enemy.turnCount || 1;
      const turnsSinceLastHeal = currentTurn - (enemy.lastHealTurn || 0);
      const totalHealingCap = Math.floor(enemy.maxHp * HEAL_TOTAL_FRACTION);

      if (turnsSinceLastHeal >= HEAL_INTERVAL_TURNS && (enemy.totalHealingReceived || 0) < totalHealingCap) {
        bossHealing = bossSystem.calculateBossHealing(enemy as any, bossAbility);
        enemy.lastHealTurn = currentTurn;
      } else if (turnsSinceLastHeal < HEAL_INTERVAL_TURNS) {
        bossAbilityMessage += `⏳ ${enemy.name} не может лечиться так часто!\n`;
      } else if ((enemy.totalHealingReceived || 0) >= totalHealingCap) {
        bossAbilityMessage += `🚫 ${enemy.name} исчерпал лечение в этом бою!\n`;
      }
    }

    // Apply damage
    let newEnemyHp = Math.max(0, enemy.hp - playerDamage);
    let newPlayerHp = Math.max(0, player.hp - enemyDamage);
    
    // Apply counter-attack damage (from defense mechanics)
    if (counterAttackDamage > 0) {
      newEnemyHp = Math.max(0, newEnemyHp - counterAttackDamage);
    }
    
    // Apply reflected damage (from defense mechanics)
    if (reflectedDamage > 0) {
      newEnemyHp = Math.max(0, newEnemyHp - reflectedDamage);
    }
    
    // Apply defense healing (from defense mechanics)
    if (defenseHealing > 0) {
      newPlayerHp = Math.min(player.max_hp, newPlayerHp + defenseHealing);
    }

    // Equipment healing that triggers on the player's own attack
    if (attackHeal > 0) {
      newPlayerHp = Math.min(player.max_hp, newPlayerHp + attackHeal);
    }

    // Passive equipment regeneration (each combat turn)
    const regen = specialEffects.analyzeRegen(effectContext());
    if (regen.healPercent !== 0 && newPlayerHp > 0) {
      const regenAmount = Math.floor(player.max_hp * regen.healPercent);
      if (regenAmount > 0) {
        newPlayerHp = Math.min(player.max_hp, newPlayerHp + regenAmount);
        if (regen.messages.length > 0) {
          classAbilityMessage += regen.messages.join('\n') + '\n';
        }
      }
    }

    // Apply lifesteal healing
    if (lifestealHealing > 0) {
      newPlayerHp = Math.min(player.max_hp, newPlayerHp + lifestealHealing);
      if (playerClassCode === 'vampire') {
        classAbilityMessage += `🩸 Вампир: lifesteal восстановил ${lifestealHealing} HP!\n`;
      }
    }

    // Apply boss healing (only if boss is still alive) with restrictions
    if (bossHealing > 0 && newEnemyHp > 0) {
      const totalHealingCap = Math.floor(enemy.maxHp * HEAL_TOTAL_FRACTION);
      const remainingHealingAllowed = totalHealingCap - (enemy.totalHealingReceived || 0);
      
      if (remainingHealingAllowed > 0) {
        const actualHealing = Math.min(bossHealing, remainingHealingAllowed);
        newEnemyHp = Math.min(enemy.maxHp, newEnemyHp + actualHealing);
        enemy.totalHealingReceived = (enemy.totalHealingReceived || 0) + actualHealing;
      }
    }

    // Last-chance equipment can cheat death once per combat. The effect is
    // marked as used only here, when it actually prevents death.
    if (newPlayerHp <= 0 && incomingReport?.preventLethal) {
      newPlayerHp = 1;
      usedOnce.push('last_chance');
      usedOnce.push('last_chance_shield');
      classAbilityMessage += '⏳ Часы последнего шанса спасли вас от смерти!\n';
    } else if (newPlayerHp <= 0 && incomingReport?.revive) {
      newPlayerHp = Math.max(1, Math.floor(player.max_hp * 0.5));
      usedOnce.push('revive');
      classAbilityMessage += '✨ Реликвия возрождения вернула вас в бой!\n';
    }
    
    // Store defense bonus for the next attack (the bonus survives until the
    // player actually spends it on an ATTACK). Repeated guards top the charge
    // up but never let it grow past the cap.
    if (nextAttackBonus > 0) {
      const bonusCap = Math.floor(effectiveAttack * MAX_STORED_DEFENSE_BONUS);
      const previousBonus = enemy.storedDefenseBonus || 0;
      const storedBonus = Math.min(bonusCap, previousBonus + nextAttackBonus);
      const addedBonus = storedBonus - previousBonus;
      enemy.storedDefenseBonus = storedBonus;
      if (addedBonus > 0 && enemyAction !== ActionType.ATTACK) {
        classAbilityMessage += `💫 Защита усилила вашу следующую атаку на +${addedBonus}!\n`;
      }
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
    
    const baseHp = 50 + (level * 25);
    const baseAttack = 8 + (level * 3);
    const baseDefense = 2 + (level * 1.5);
    
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
