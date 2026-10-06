import { db } from '../database/db';
import { Enemy } from './CombatEngine';
import { ActionType } from '../types/game.types';

export interface BossAbility {
  name: string;
  description: string;
  damage_multiplier?: number;
  defense_multiplier?: number;
  heal_amount?: number;
  condition?: string; // 'low_hp', 'high_hp', 'random'
  cooldown?: number;
  icon: string;
}

export interface BossPhase {
  hp_threshold: number; // Процент HP для активации фазы
  abilities: string[];
  damage_bonus: number;
  defense_bonus: number;
  description: string;
}

export interface BossConfig {
  id?: number;
  name: string;
  title: string;
  description: string;
  floor: number;
  level: number;
  base_hp: number;
  base_attack: number;
  base_defense: number;
  abilities: BossAbility[];
  phases?: BossPhase[];
  ai_type: 'aggressive' | 'defensive' | 'adaptive' | 'chaotic' | 'tactical';
  icon: string;
  loot_multiplier: number;
  weakness?: string; // Класс, против которого слабее
  resistance?: string; // Класс, против которого сильнее
}

export class BossSystem {
  
  // Предопределённые способности боссов
  private readonly BOSS_ABILITIES: Record<string, BossAbility> = {
    'power_strike': {
      name: 'Мощный удар',
      description: 'Наносит 150% урона',
      damage_multiplier: 1.5,
      icon: '💥',
    },
    'defensive_stance': {
      name: 'Защитная стойка',
      description: 'Увеличивает защиту на 100%',
      defense_multiplier: 2.0,
      icon: '🛡️',
    },
    'berserker_rage': {
      name: 'Ярость берсерка',
      description: 'При HP < 30% урон увеличивается на 200%',
      damage_multiplier: 2.0,
      condition: 'low_hp',
      icon: '😡',
    },
    'heal': {
      name: 'Исцеление',
      description: 'Восстанавливает 20% HP',
      heal_amount: 0.2,
      cooldown: 3,
      icon: '💚',
    },
    'counter_attack': {
      name: 'Контратака',
      description: 'Контратакует при защите игрока',
      damage_multiplier: 1.3,
      condition: 'player_defend',
      icon: '⚡',
    },
    'adaptation': {
      name: 'Адаптация',
      description: 'Изучает паттерны игрока быстрее',
      icon: '🧠',
    },
    'life_drain': {
      name: 'Похищение жизни',
      description: 'Восстанавливает HP равное 30% нанесённого урона',
      heal_amount: 0.3,
      icon: '🩸',
    },
    'elemental_blast': {
      name: 'Стихийный взрыв',
      description: 'Мощная атака, игнорирующая часть защиты',
      damage_multiplier: 1.8,
      icon: '🔥',
    },
  };

  getBossConfig(floor: number): BossConfig {
    const level = Math.floor(floor / 10);
    
    // Определяем босса по этажу
    const bossIndex = Math.floor(floor / 10) - 1;
    const bossConfigs = this.getAllBossConfigs();
    
    // Если есть предопределённый босс, используем его
    if (bossIndex < bossConfigs.length) {
      return this.scaleBossToFloor(bossConfigs[bossIndex], floor);
    }
    
    // Иначе генерируем процедурного босса
    return this.generateProceduralBoss(floor);
  }

  private getAllBossConfigs(): BossConfig[] {
    return [
      // Floor 10
      {
        name: 'Страж Врат',
        title: 'Первый хранитель',
        description: 'Древний страж, охраняющий вход в башню',
        floor: 10,
        level: 1,
        base_hp: 200,
        base_attack: 15,
        base_defense: 10,
        abilities: [
          this.BOSS_ABILITIES['power_strike'],
          this.BOSS_ABILITIES['defensive_stance'],
        ],
        ai_type: 'defensive',
        icon: '🗿',
        loot_multiplier: 1.5,
      },
      
      // Floor 20
      {
        name: 'Костяной Дракон',
        title: 'Нежить драконьего рода',
        description: 'Восставший из мёртвых дракон',
        floor: 20,
        level: 2,
        base_hp: 350,
        base_attack: 20,
        base_defense: 15,
        abilities: [
          this.BOSS_ABILITIES['power_strike'],
          this.BOSS_ABILITIES['elemental_blast'],
          this.BOSS_ABILITIES['berserker_rage'],
        ],
        phases: [
          {
            hp_threshold: 50,
            abilities: ['elemental_blast', 'power_strike'],
            damage_bonus: 1.3,
            defense_bonus: 0.9,
            description: 'Дракон разъярён!',
          },
        ],
        ai_type: 'aggressive',
        icon: '🐉',
        loot_multiplier: 2.0,
        weakness: 'arcanist',
      },
      
      // Floor 30
      {
        name: 'Владыка Теней',
        title: 'Повелитель тьмы',
        description: 'Тёмный маг, владеющий силами тени',
        floor: 30,
        level: 3,
        base_hp: 500,
        base_attack: 25,
        base_defense: 18,
        abilities: [
          this.BOSS_ABILITIES['adaptation'],
          this.BOSS_ABILITIES['counter_attack'],
          this.BOSS_ABILITIES['life_drain'],
        ],
        ai_type: 'adaptive',
        icon: '👤',
        loot_multiplier: 2.5,
        weakness: 'tactician',
      },
      
      // Floor 40
      {
        name: 'Повелитель Пламени',
        title: 'Огненный титан',
        description: 'Элементаль чистого огня',
        floor: 40,
        level: 4,
        base_hp: 700,
        base_attack: 30,
        base_defense: 20,
        abilities: [
          this.BOSS_ABILITIES['elemental_blast'],
          this.BOSS_ABILITIES['berserker_rage'],
          this.BOSS_ABILITIES['power_strike'],
        ],
        phases: [
          {
            hp_threshold: 70,
            abilities: ['elemental_blast'],
            damage_bonus: 1.2,
            defense_bonus: 1.0,
            description: 'Пламя разгорается!',
          },
          {
            hp_threshold: 30,
            abilities: ['elemental_blast', 'berserker_rage'],
            damage_bonus: 1.5,
            defense_bonus: 0.8,
            description: 'Инферно!',
          },
        ],
        ai_type: 'aggressive',
        icon: '🔥',
        loot_multiplier: 3.0,
        resistance: 'arcanist',
      },
      
      // Floor 50
      {
        name: 'Ледяной Колосс',
        title: 'Вечная мерзлота',
        description: 'Гигантское создание из льда',
        floor: 50,
        level: 5,
        base_hp: 900,
        base_attack: 28,
        base_defense: 35,
        abilities: [
          this.BOSS_ABILITIES['defensive_stance'],
          this.BOSS_ABILITIES['heal'],
          this.BOSS_ABILITIES['counter_attack'],
        ],
        ai_type: 'defensive',
        icon: '❄️',
        loot_multiplier: 3.5,
        weakness: 'berserker',
      },
    ];
  }

  private scaleBossToFloor(config: BossConfig, floor: number): BossConfig {
    const scaleFactor = floor / config.floor;
    
    return {
      ...config,
      floor,
      level: Math.floor(floor / 10),
      base_hp: Math.floor(config.base_hp * scaleFactor),
      base_attack: Math.floor(config.base_attack * scaleFactor),
      base_defense: Math.floor(config.base_defense * scaleFactor),
    };
  }

  private generateProceduralBoss(floor: number): BossConfig {
    const level = Math.floor(floor / 10);
    
    const names = [
      'Архидемон', 'Титан Хаоса', 'Пожиратель Душ', 'Владыка Бездны',
      'Древний Ужас', 'Разрушитель Миров', 'Вестник Апокалипсиса'
    ];
    
    const titles = [
      'Забытый', 'Вечный', 'Проклятый', 'Несокрушимый', 
      'Последний', 'Абсолютный'
    ];
    
    const aiTypes: Array<'aggressive' | 'defensive' | 'adaptive' | 'chaotic' | 'tactical'> = 
      ['aggressive', 'defensive', 'adaptive', 'chaotic', 'tactical'];
    
    const name = names[Math.floor(Math.random() * names.length)];
    const title = titles[Math.floor(Math.random() * titles.length)];
    
    // Выбираем 3-4 случайные способности
    const abilityKeys = Object.keys(this.BOSS_ABILITIES);
    const selectedAbilities: BossAbility[] = [];
    const abilityCount = 3 + Math.floor(Math.random() * 2);
    
    for (let i = 0; i < abilityCount; i++) {
      const randomKey = abilityKeys[Math.floor(Math.random() * abilityKeys.length)];
      selectedAbilities.push(this.BOSS_ABILITIES[randomKey]);
    }
    
    return {
      name,
      title,
      description: `Могущественный ${title.toLowerCase()} босс ${level} уровня`,
      floor,
      level,
      base_hp: 150 + (level * 50),
      base_attack: 15 + (level * 5),
      base_defense: 10 + (level * 3),
      abilities: selectedAbilities,
      ai_type: aiTypes[Math.floor(Math.random() * aiTypes.length)],
      icon: '👑',
      loot_multiplier: 1.5 + (level * 0.5),
    };
  }

  generateBossEnemy(floor: number): Enemy & { boss_config: BossConfig; current_phase?: BossPhase } {
    const config = this.getBossConfig(floor);
    
    return {
      id: undefined,
      name: `${config.icon} ${config.name}`,
      hp: config.base_hp,
      maxHp: config.base_hp,
      attack: config.base_attack,
      defense: config.base_defense,
      level: config.level,
      isBoss: true,
      boss_config: config,
    };
  }

  checkPhaseTransition(boss: Enemy & { boss_config: BossConfig }, currentHp: number): BossPhase | null {
    if (!boss.boss_config.phases) return null;
    
    const hpPercent = (currentHp / boss.maxHp) * 100;
    
    for (const phase of boss.boss_config.phases) {
      if (hpPercent <= phase.hp_threshold) {
        return phase;
      }
    }
    
    return null;
  }

  selectBossAction(
    boss: Enemy & { boss_config: BossConfig },
    currentHp: number,
    playerAction: ActionType,
    turnCount: number
  ): { action: ActionType; ability?: BossAbility; message: string } {
    
    const config = boss.boss_config;
    const hpPercent = (currentHp / boss.maxHp) * 100;
    
    // Проверяем активацию способностей по условиям
    for (const ability of config.abilities) {
      // Low HP abilities
      if (ability.condition === 'low_hp' && hpPercent < 30) {
        return {
          action: ActionType.ATTACK,
          ability,
          message: `${config.icon} ${boss.name} использует ${ability.icon} ${ability.name}!`,
        };
      }
      
      // Counter attack when player defends
      if (ability.condition === 'player_defend' && playerAction === ActionType.DEFEND) {
        return {
          action: ActionType.ATTACK,
          ability,
          message: `${config.icon} ${boss.name} использует ${ability.icon} ${ability.name}!`,
        };
      }
      
      // Heal ability at low HP
      if (ability.heal_amount && hpPercent < 40 && turnCount % (ability.cooldown || 5) === 0) {
        return {
          action: ActionType.DEFEND,
          ability,
          message: `${config.icon} ${boss.name} использует ${ability.icon} ${ability.name}!`,
        };
      }
    }
    
    // Поведение по AI type
    switch (config.ai_type) {
      case 'aggressive':
        // Всегда атакует
        return {
          action: ActionType.ATTACK,
          message: `${config.icon} ${boss.name} яростно атакует!`,
        };
      
      case 'defensive':
        // Чередует атаку и защиту
        return {
          action: turnCount % 2 === 0 ? ActionType.ATTACK : ActionType.DEFEND,
          message: turnCount % 2 === 0 
            ? `${config.icon} ${boss.name} атакует!`
            : `${config.icon} ${boss.name} принимает защитную стойку!`,
        };
      
      case 'adaptive':
        // Контрит действие игрока
        return {
          action: playerAction === ActionType.ATTACK ? ActionType.DEFEND : ActionType.ATTACK,
          message: `${config.icon} ${boss.name} адаптируется к вашей тактике!`,
        };
      
      case 'chaotic':
        // Случайное
        return {
          action: Math.random() > 0.5 ? ActionType.ATTACK : ActionType.DEFEND,
          message: `${config.icon} ${boss.name} непредсказуем!`,
        };
      
      case 'tactical':
        // Умный выбор
        if (hpPercent > 70) {
          return { action: ActionType.ATTACK, message: `${config.icon} ${boss.name} агрессивно наступает!` };
        } else if (hpPercent > 30) {
          return { action: playerAction === ActionType.ATTACK ? ActionType.DEFEND : ActionType.ATTACK, message: `${config.icon} ${boss.name} действует тактично!` };
        } else {
          return { action: ActionType.ATTACK, message: `${config.icon} ${boss.name} в отчаянии!` };
        }
      
      default:
        return {
          action: ActionType.ATTACK,
          message: `${config.icon} ${boss.name} атакует!`,
        };
    }
  }

  applyBossAbilityModifiers(
    baseDamage: number,
    baseDefense: number,
    ability?: BossAbility
  ): { damage: number; defense: number } {
    let damage = baseDamage;
    let defense = baseDefense;
    
    if (ability) {
      if (ability.damage_multiplier) {
        damage = Math.floor(damage * ability.damage_multiplier);
      }
      if (ability.defense_multiplier) {
        defense = Math.floor(defense * ability.defense_multiplier);
      }
    }
    
    return { damage, defense };
  }

  calculateBossHealing(boss: Enemy & { boss_config: BossConfig }, ability?: BossAbility, damageDealt?: number): number {
    if (!ability || !ability.heal_amount) return 0;
    
    if (damageDealt !== undefined) {
      // Life drain - процент от урона
      return Math.floor(damageDealt * ability.heal_amount);
    } else {
      // Обычное исцеление - процент от максимального HP
      return Math.floor(boss.maxHp * ability.heal_amount);
    }
  }
}

export const bossSystem = new BossSystem();
