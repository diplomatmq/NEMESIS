import { db } from '../database/db';
import { Enemy } from './CombatEngine';
import { ActionType } from '../types/game.types';
import { SeededRandom } from './SeededRandom';

export interface BossAbility {
  name: string;
  description: string;
  damage_multiplier?: number;
  defense_multiplier?: number;
  heal_amount?: number;
  condition?: string; // 'low_hp', 'high_hp', 'random'
  cooldown?: number;
  icon: string;
  action?: ActionType; // Action the boss performs when this ability is used
}

/** Minimum number of turns between two boss heals. Shared with CombatEngine. */
export const HEAL_INTERVAL_TURNS = 4;
/** Maximum total healing a boss can receive per fight, as a fraction of max HP. */
export const HEAL_TOTAL_FRACTION = 0.20;
/**
 * Total chance that any single ability is used on a given turn. It is a single
 * roll, so a boss with many abilities is not stronger than one with few.
 */
export const ABILITY_ACTIVATION_CHANCE = 0.5;
/** Weight multiplier for the action the Tactician predicted. */
export const PREDICTION_ACTION_BIAS = 2.0;
/** Chance the fallback behaviour follows the prediction when it disagrees. */
export const PREDICTION_FALLBACK_CHANCE = 0.35;

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
      action: ActionType.ATTACK,
    },
    'defensive_stance': {
      name: 'Защитная стойка',
      description: 'Увеличивает защиту на 100%',
      defense_multiplier: 2.0,
      icon: '🛡️',
      action: ActionType.DEFEND,
    },
    'berserker_rage': {
      name: 'Ярость берсерка',
      description: 'При HP < 30% урон увеличивается на 200%',
      damage_multiplier: 2.0,
      condition: 'low_hp',
      icon: '😡',
      action: ActionType.ATTACK,
    },
    'heal': {
      name: 'Исцеление',
      description: 'Восстанавливает 5-10% текущего HP',
      heal_amount: 0.05, // Базовое значение, будет умножаться на random(1-2)
      cooldown: 3,
      icon: '💚',
      action: ActionType.DEFEND,
    },
    'counter_attack': {
      name: 'Контратака',
      description: 'Контратакует при защите игрока',
      damage_multiplier: 1.3,
      condition: 'player_defend',
      icon: '⚡',
      action: ActionType.ATTACK,
    },
    'adaptation': {
      name: 'Адаптация',
      description: 'Изучает паттерны игрока быстрее',
      icon: '🧠',
      action: ActionType.ATTACK,
    },
    'life_drain': {
      name: 'Похищение жизни',
      description: 'Восстанавливает HP равное 20% нанесённого урона',
      heal_amount: 0.2, // Снижено с 0.3 до 0.2
      icon: '🩸',
      action: ActionType.ATTACK,
    },
    'elemental_blast': {
      name: 'Стихийный взрыв',
      description: 'Мощная атака, игнорирующая часть защиты',
      damage_multiplier: 1.8,
      icon: '🔥',
      action: ActionType.ATTACK,
    },
  };

  getBossConfigS1(floor: number, seasonId: number): BossConfig {
    const level = Math.floor(floor / 10);
    
    // Определяем босса по этажу
    const bossIndex = Math.floor(floor / 10) - 1;
    const bossConfigs = this.getExpandedBossConfigs();
    
    // Если есть предопределённый босс, используем его
    if (bossIndex < bossConfigs.length) {
      return this.scaleBossToFloor(bossConfigs[bossIndex], floor);
    }

    return this.generateProceduralBoss(floor, seasonId);
  }

  getBossConfig(floor: number, seasonId: number): BossConfig {
    return this.getBossConfigS1(floor, seasonId);
  }

    /**
     * Every tenth floor has its own named boss. The data is generated from a
     * fixed catalogue so floors 10..500 are deterministic and fully described.
     * 
     * Boss stat formula changes (NEW BALANCE):
     * - HP: 300 + level * 150
     * - ATK: 20 + level * 7 (up to L=10), then 90 + (level - 10) * 2.7 (slower growth)
     * - DEF: 6 + level * 2 (up to L=10), then 26 + (level - 10) * 0.9 (slower growth)
     * 
     * Individual boss multipliers applied on top of base stats.
     */
    private getExpandedBossConfigs(): BossConfig[] {
      const bosses: Array<[string, string, string, string, string]> = [
        ['Страж Врат', 'Первый хранитель', 'Древний страж входа', 'defensive', 'guardian'],
        ['Костяной Дракон', 'Нежить драконьего рода', 'Восставший дракон из костяных пустошей', 'aggressive', 'arcanist'],
        ['Владыка Теней', 'Повелитель тьмы', 'Маг, питающийся страхом путников', 'adaptive', 'tactician'],
        ['Повелитель Пламени', 'Огненный титан', 'Элементаль чистого огня', 'aggressive', 'vampire'],
        ['Ледяной Колосс', 'Вечная мерзлота', 'Гигант, скованный древним льдом', 'defensive', 'berserker'],
        ['Королева Пауков', 'Мать ядовитого улья', 'Хозяйка тысячи паутинных тоннелей', 'tactical', 'assassin'],
        ['Гниющий Друид', 'Голос проклятого леса', 'Древесный маг, поднявший мёртвые корни', 'adaptive', 'arcanist'],
        ['Железный Голем', 'Кузня воли', 'Живой механизм, выкованный в башне', 'defensive', 'berserker'],
        ['Громовой Виверн', 'Крыло бури', 'Дракон, несущий молнии над башней', 'aggressive', 'guardian'],
        ['Архимаг Предела', 'Последний учёный', 'Маг, разорвавший границы заклинаний', 'tactical', 'jester'],
        ['Песчаный Пожиратель', 'Владыка дюн', 'Чудовище, поглощающее целые караваны', 'chaotic', 'vampire'],
        ['Рыцарь Пепла', 'Несломленный клятвопреступник', 'Воин, вернувшийся из погребального костра', 'defensive', 'berserker'],
        ['Морская Ведьма', 'Певица глубин', 'Колдунья, затопившая нижние залы', 'adaptive', 'arcanist'],
        ['Минотавр Лабиринта', 'Хозяин тысячи стен', 'Непобедимый охотник закрытых проходов', 'aggressive', 'assassin'],
        ['Хранитель Часов', 'Сломанный хронос', 'Существо, застрявшее между мгновениями', 'tactical', 'tactician'],
        ['Алый Палач', 'Клинок кровавой луны', 'Палач, который никогда не промахивается', 'aggressive', 'guardian'],
        ['Некромант-Король', 'Повелитель костей', 'Монарх армии, которой не нужен сон', 'adaptive', 'necromancer'],
        ['Призрачный Адмирал', 'Флот мёртвых вод', 'Капитан корабля, пришедшего из могилы', 'tactical', 'jester'],
        ['Химера Бездны', 'Три голоса хаоса', 'Слияние трёх древних хищников', 'chaotic', 'assassin'],
        ['Вулканический Титан', 'Сердце магмы', 'Гигант, шагающий по раскалённым залам', 'aggressive', 'arcanist'],
        ['Сфинкс Забвения', 'Загадка без ответа', 'Хранительница дверей, стирающая память', 'tactical', 'jester'],
        ['Чумной Епископ', 'Проповедник распада', 'Носитель болезни, которой боятся даже демоны', 'adaptive', 'vampire'],
        ['Лунный Охотник', 'Серебряный след', 'Невидимый зверь, преследующий слабых', 'chaotic', 'assassin'],
        ['Башенный Разрушитель', 'Осадная машина', 'Живой таран древней цивилизации', 'aggressive', 'guardian'],
        ['Дракон Миражей', 'Сон пустыни', 'Иллюзия, ставшая плотью', 'chaotic', 'jester'],
        ['Морозный Лич', 'Вечный холод', 'Лич, запечатавший собственное сердце', 'defensive', 'arcanist'],
        ['Король Гоблинов', 'Собиратель корон', 'Хитрый правитель подземных племён', 'tactical', 'tactician'],
        ['Змей Девяти Клыков', 'Яд глубин', 'Древняя змея, охраняющая чёрный алтарь', 'adaptive', 'vampire'],
        ['Стальной Самурай', 'Последняя стойка', 'Дух воина, отказавшийся умирать', 'defensive', 'assassin'],
        ['Колдунья Багрового Дождя', 'Небо из крови', 'Ведьма, меняющая погоду проклятиями', 'chaotic', 'arcanist'],
        ['Пожиратель Звёзд', 'Бездна над башней', 'Космический хищник, упавший в этот мир', 'aggressive', 'jester'],
        ['Титан Корней', 'Сердце чащи', 'Гора древесины и древней ярости', 'defensive', 'guardian'],
        ['Владыка Зеркал', 'Тысяча отражений', 'Противник, копирующий каждое движение', 'adaptive', 'tactician'],
        ['Граф Ноктюрн', 'Бессмертная ночь', 'Вампир, превративший этаж в замок', 'tactical', 'vampire'],
        ['Оракул Пустоты', 'Глаз за гранью', 'Прорицатель, видящий все варианты будущего', 'tactical', 'jester'],
        ['Демон-Кузнец', 'Молот преисподней', 'Кузнец оружия, способного убивать богов', 'aggressive', 'berserker'],
        ['Повелитель Миазмов', 'Дыхание гнили', 'Туманное существо из забытой чумы', 'adaptive', 'necromancer'],
        ['Феникс Пепла', 'Последнее возрождение', 'Птица, воскресающая после каждого поражения', 'chaotic', 'vampire'],
        ['Кристальный Страж', 'Осколок вечности', 'Живая крепость из неземного кристалла', 'defensive', 'guardian'],
        ['Ведьмак Бездны', 'Охотник на героев', 'Наёмник, изучивший слабости всех классов', 'tactical', 'assassin'],
        ['Левиафан Небес', 'Затмение крыльев', 'Гигант, закрывающий собой луну', 'aggressive', 'arcanist'],
        ['Ткач Судеб', 'Нить последнего часа', 'Существо, переписывающее судьбы путников', 'adaptive', 'tactician'],
        ['Император Мёртвых', 'Трон костей', 'Владыка всех павших на нижних этажах', 'defensive', 'necromancer'],
        ['Сердце Бури', 'Живой ураган', 'Сгусток молний и разрушительной воли', 'chaotic', 'jester'],
        ['Архидемон Врат', 'Печать последнего круга', 'Демон, охраняющий путь к вершине', 'aggressive', 'berserker'],
        ['Астральный Колосс', 'Тело созвездия', 'Гигант из света далёких миров', 'defensive', 'arcanist'],
        ['Повелитель Хаоса', 'Случайность плоти', 'Непредсказуемый разум без единой формы', 'chaotic', 'jester'],
        ['Последний Рыцарь', 'Клятва вершины', 'Защитник финального подъёма', 'tactical', 'guardian'],
        ['Апокалипсис', 'Конец пути', 'Древняя сила, ожидавшая у вершины башни', 'adaptive', 'necromancer'],
        ['Вершинный Судья', 'Приговор башни', 'Последний испытатель, оценивающий каждого героя', 'defensive', 'tactician'],
      ];

      return bosses.map((boss, index) => {
        const floor = (index + 1) * 10;
        const level = index + 1;
        const [name, title, description, aiType, weakness] = boss;
        const abilityNames = [
          'power_strike',
          index % 3 === 0 ? 'defensive_stance' : 'elemental_blast',
          index % 4 === 0 ? 'heal' : index % 4 === 1 ? 'counter_attack' : 'adaptation',
        ];
        const signatureAbility = this.createSignatureAbility(index, name);
        
        // NEW BALANCE: Adjusted stat scaling after level 10
        const baseHp = 300 + level * 150;
        const baseAttack = level <= 10 
          ? 20 + level * 7 
          : Math.round(90 + (level - 10) * 2.7);
        const baseDefense = level <= 10 
          ? 6 + level * 2 
          : Math.round(26 + (level - 10) * 0.9);
        
        // Apply boss-specific multipliers
        let atkMultiplier = 1.0;
        let defMultiplier = 1.0;
        
        // Specific boss adjustments (from balance spec)
        switch (floor) {
          case 20: // Костяной Дракон - reduce burst damage
            atkMultiplier = 0.95;
            break;
          case 30: // Владыка Теней - allow more counterplay
            atkMultiplier = 0.95;
            defMultiplier = 0.95;
            break;
          case 40: // Повелитель Пламени - weaken enhanced fire strikes
            atkMultiplier = 0.85;
            defMultiplier = 0.90;
            break;
          case 50: // Ледяной Колосс - keep base difficulty
            break;
          case 60: // Королева Пауков - reduce control and multi-attack frequency
            atkMultiplier = 0.90;
            defMultiplier = 0.90;
            break;
          case 70: // Гниющий Друид - limit healing
            atkMultiplier = 0.90;
            defMultiplier = 0.95;
            break;
          case 80: // Железный Голем - weaken defense, not HP pool
            atkMultiplier = 0.90;
            defMultiplier = 0.85;
            break;
          case 90: // Громовой Виверн - limit strongest attack chain
            atkMultiplier = 0.80;
            defMultiplier = 0.90;
            break;
          case 100: // Архимаг Предела - limit enhanced magic strikes
            atkMultiplier = 0.90;
            defMultiplier = 0.95;
            break;
          default:
            // For floors 110-500: gradual weakening
            if (floor >= 110 && floor <= 190) {
              atkMultiplier = 0.92;
              defMultiplier = 0.95;
            } else if (floor >= 200 && floor <= 300) {
              atkMultiplier = 0.87;
              defMultiplier = 0.92;
            } else if (floor >= 310 && floor <= 400) {
              atkMultiplier = 0.85;
              defMultiplier = 0.90;
            } else if (floor >= 410) {
              atkMultiplier = 0.85;
              defMultiplier = 0.90;
            }
        }
        
        // Late floors grow tankier and hit slightly harder. This tuning is a
        // distinct step from the per-boss multipliers above, so no factor is
        // ever applied twice.
        const tuning = this.getBossFloorTuning(floor);

        return {
          name,
          title,
          description,
          floor,
          level,
          base_hp: Math.round(baseHp * tuning.hp),
          base_attack: Math.round(baseAttack * atkMultiplier * tuning.attack),
          base_defense: Math.round(baseDefense * defMultiplier),
          abilities: [
            ...abilityNames.map((ability) => this.BOSS_ABILITIES[ability]),
            signatureAbility,
          ],
          ai_type: aiType as BossConfig['ai_type'],
          icon: ['👹', '🐉', '💀', '🔥', '❄️'][index % 5],
          loot_multiplier: 1.5 + level * 0.1,
          weakness,
        };
      });
    }

  private createSignatureAbility(index: number, bossName: string): BossAbility {
    // Limit signature damage multiplier to prevent excessive burst
    const damageMultiplier = Math.min(1.30, 1.15 + (index % 6) * 0.1);
    const abilityVariants = [
      ['Разлом брони', 'Временно снижает защиту игрока', '🪓'],
      ['Кровавая метка', 'Усиливает следующий удар босса', '🩸'],
      ['Печать молчания', 'Ослабляет способности игрока', '🔇'],
      ['Зеркальный выпад', 'Повторяет часть последнего урона', '🪞'],
      ['Пожирание света', 'Наносит урон и восстанавливает здоровье', '🌑'],
      ['Цепь хаоса', 'Меняет стиль атаки каждый ход', '⛓️'],
    ];
    const [variant, description, icon] = abilityVariants[index % abilityVariants.length];
    return {
      name: `${variant} ${index + 1}`,
      description: `${description}. Особенность босса: ${bossName}.`,
      damage_multiplier: damageMultiplier,
      heal_amount: index % 5 === 0 ? 0.05 + (index % 4) * 0.02 : undefined,
      condition: index % 2 === 0 ? 'random' : 'low_hp',
      cooldown: 2 + (index % 4),
      icon,
      action: ActionType.ATTACK,
    };
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
        base_hp: 300,
        base_attack: 22, // Увеличено +10% от 20 (было 15)
        base_defense: 8, // Вернули к 8
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
        base_hp: 600,
        base_attack: 28, // Увеличено +10% от 25 (было 20)
        base_defense: 10,
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
        base_hp: 750,
        base_attack: 36, // Увеличено +10% от 33 (было 25)
        base_defense: 12,
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
        base_hp: 900,
        base_attack: 44, // Увеличено +10% от 40 (было 30)
        base_defense: 14,
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
        base_hp: 1050,
        base_attack: 42, // Увеличено +10% от 38 (было 28)
        base_defense: 16,
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

  /**
   * Stepwise tuning for the late tower. Bands are aligned to the ten-floor
   * gear tiers because player power does not grow smoothly: it jumps when a
   * new equipment level unlocks and stays almost flat until the next one.
   * Measured player defence even regresses at the level-50 tier, so the
   * 410-500 band is deliberately softer than 360-409; a strictly increasing
   * curve would make the last floors unwinnable. Each band only touches HP
   * and attack and never doubles an existing multiplier.
   */
  private getBossFloorTuning(floor: number): { hp: number; attack: number } {
    if (floor >= 410) return { hp: 0.90, attack: 0.90 };
    if (floor >= 360) return { hp: 1.28, attack: 1.12 };
    if (floor >= 310) return { hp: 1.20, attack: 1.10 };
    if (floor >= 260) return { hp: 0.94, attack: 0.97 };
    if (floor >= 190) return { hp: 0.96, attack: 0.98 };
    if (floor >= 110) return { hp: 1.06, attack: 1.03 };
    if (floor >= 100) return { hp: 1.24, attack: 1.11 };
    if (floor >= 60) return { hp: 1.08, attack: 1.03 };
    return { hp: 1, attack: 1 };
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

  private generateProceduralBoss(floor: number, seasonId: number): BossConfig {
    const level = Math.floor(floor / 10);
    
    // Use seeded random for deterministic generation
    const rng = SeededRandom.forFloor(floor, seasonId);
    
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
    
    const name = rng.choose(names);
    const title = rng.choose(titles);
    
    // Выбираем 3-4 случайные способности детерминированно
    const abilityKeys = Object.keys(this.BOSS_ABILITIES);
    const selectedAbilities: BossAbility[] = [];
    const abilityCount = 3 + rng.nextInt(0, 1);
    
    const shuffledKeys = rng.shuffle(abilityKeys);
    for (let i = 0; i < abilityCount && i < shuffledKeys.length; i++) {
      selectedAbilities.push(this.BOSS_ABILITIES[shuffledKeys[i]]);
    }
    
    // NEW BALANCE: Updated scaling formulas
    const baseHp = 300 + (level * 150);
    const baseAttack = level <= 10 
      ? 20 + (level * 7) 
      : Math.round(90 + (level - 10) * 2.7);
    const baseDefense = level <= 10 
      ? 6 + (level * 2) 
      : Math.round(26 + (level - 10) * 0.9);
    
    // Apply floor-range multipliers for procedural bosses
    let atkMultiplier = 1.0;
    let defMultiplier = 1.0;
    
    if (floor >= 110 && floor <= 190) {
      atkMultiplier = 0.92;
      defMultiplier = 0.95;
    } else if (floor >= 200 && floor <= 300) {
      atkMultiplier = 0.87;
      defMultiplier = 0.92;
    } else if (floor >= 310 && floor <= 400) {
      atkMultiplier = 0.85;
      defMultiplier = 0.90;
    } else if (floor >= 410) {
      atkMultiplier = 0.85;
      defMultiplier = 0.90;
    }
    
    // Apply the same late-floor tuning as the named bosses so procedural
    // fights share the intended difficulty curve.
    const tuning = this.getBossFloorTuning(floor);

    return {
      name,
      title,
      description: `Могущественный ${title.toLowerCase()} босс ${level} уровня`,
      floor,
      level,
      base_hp: Math.round(baseHp * tuning.hp),
      base_attack: Math.round(baseAttack * atkMultiplier * tuning.attack),
      base_defense: Math.round(baseDefense * defMultiplier),
      abilities: selectedAbilities,
      ai_type: rng.choose(aiTypes),
      icon: '👑',
      loot_multiplier: 1.5 + (level * 0.5),
    };
  }

  generateBossEnemy(floor: number, seasonId: number): Enemy & { boss_config: BossConfig; current_phase?: BossPhase } {
    const config = this.getBossConfigS1(floor, seasonId);
    
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
    turnCount: number,
    predictedEnemyAction?: ActionType
  ): { action: ActionType; ability?: BossAbility; message: string } {
    
    const config = boss.boss_config;
    const hpPercent = (currentHp / boss.maxHp) * 100;

    // Track when each ability was last used so cooldowns are respected for
    // every trigger type (low_hp, random, ...), not just healing.
    boss.abilityCooldowns = boss.abilityCooldowns || {};
    const defaultCooldown = 3;
    const canUse = (ability: BossAbility): boolean => {
      const lastUsed = boss.abilityCooldowns![ability.name];
      if (lastUsed === undefined) return true;
      return turnCount - lastUsed >= (ability.cooldown ?? defaultCooldown);
    };

    // Healing shares its interval and total cap with CombatEngine, so the
    // selector never proposes a heal the combat loop would refuse.
    const healAvailable = (): boolean => {
      if (turnCount - (boss.lastHealTurn || 0) < HEAL_INTERVAL_TURNS) return false;
      const totalCap = Math.floor(boss.maxHp * HEAL_TOTAL_FRACTION);
      return (boss.totalHealingReceived || 0) < totalCap;
    };

    const isEligible = (ability: BossAbility): boolean => {
      if (!canUse(ability)) return false;
      if (ability.condition === 'low_hp' && hpPercent >= 30) return false;
      if (ability.condition === 'player_defend' && playerAction !== ActionType.DEFEND) return false;
      // Every healing ability, attacking drains included, obeys the shared
      // interval and total cap, so no heal is activated only to be refused by
      // the combat loop while still burning its cooldown.
      if (ability.heal_amount && !healAvailable()) return false;
      return true;
    };

    const candidates = config.abilities.filter(isEligible);

    // A single roll decides whether any ability fires, so a boss with many
    // abilities is not stronger than one with only a few.
    if (candidates.length > 0 && Math.random() < ABILITY_ACTIVATION_CHANCE) {
      // The predicted action gets a heavier weight, but never a guarantee.
      const weights = candidates.map((ability) =>
        predictedEnemyAction !== undefined && ability.action === predictedEnemyAction
          ? PREDICTION_ACTION_BIAS
          : 1
      );
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      let roll = Math.random() * totalWeight;
      let chosen = candidates[candidates.length - 1];
      for (let i = 0; i < candidates.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
          chosen = candidates[i];
          break;
        }
      }

      // Cooldown is only marked when the ability is actually activated.
      boss.abilityCooldowns![chosen.name] = turnCount;
      return {
        action: chosen.action ?? ActionType.ATTACK,
        ability: chosen,
        message: `${config.icon} ${boss.name} использует ${chosen.icon} ${chosen.name}!`,
      };
    }

    const base = this.selectFallbackAction(
      config,
      hpPercent,
      playerAction,
      turnCount,
      canUse,
      boss.abilityCooldowns
    );

    // The Tactician's forecast biases the boss towards the predicted action
    // without forcing it: the boss may still act differently.
    if (predictedEnemyAction !== undefined && base.action !== predictedEnemyAction
      && Math.random() < PREDICTION_FALLBACK_CHANCE) {
      const actionText = predictedEnemyAction === ActionType.ATTACK ? 'атакует' : 'защищается';
      return { action: predictedEnemyAction, message: `${config.icon} ${boss.name} ${actionText}!` };
    }

    return base;
  }

  private selectFallbackAction(
    config: BossConfig,
    hpPercent: number,
    playerAction: ActionType,
    turnCount: number,
    canUse: (ability: BossAbility) => boolean,
    abilityCooldowns: Record<string, number>
  ): { action: ActionType; ability?: BossAbility; message: string } {
    // Поведение по AI type
    switch (config.ai_type) {
      case 'aggressive':
        // Всегда атакует
        return {
          action: ActionType.ATTACK,
          message: `${config.icon} ${config.name} яростно атакует!`,
        };
      
      case 'defensive': {
        // Чередует атаку и защиту. При защите использует защитную стойку,
        // чтобы усиление защиты реально учитывалось при уроне игрока.
        if (turnCount % 2 === 0) {
          return {
            action: ActionType.ATTACK,
            message: `${config.icon} ${config.name} атакует!`,
          };
        }
        // The stance respects its cooldown here too. If it is still recharging
        // the boss simply attacks instead of reusing it every other turn.
        const stance = config.abilities.find((a) => a.defense_multiplier && canUse(a));
        if (!stance) {
          return {
            action: ActionType.ATTACK,
            message: `${config.icon} ${config.name} атакует!`,
          };
        }
        abilityCooldowns[stance.name] = turnCount;
        return {
          action: ActionType.DEFEND,
          ability: stance,
          message: `${config.icon} ${config.name} принимает защитную стойку!`,
        };
      }
      
      case 'adaptive':
        // Контрит действие игрока, но не всегда (60% шанс на адаптацию)
        if (Math.random() < 0.6) {
          return {
            action: playerAction === ActionType.ATTACK ? ActionType.DEFEND : ActionType.ATTACK,
            message: `${config.icon} ${config.name} адаптируется к вашей тактике!`,
          };
        } else {
          return {
            action: ActionType.ATTACK,
            message: `${config.icon} ${config.name} атакует!`,
          };
        }
      
      case 'chaotic':
        // Случайное
        return {
          action: Math.random() > 0.5 ? ActionType.ATTACK : ActionType.DEFEND,
          message: `${config.icon} ${config.name} непредсказуем!`,
        };
      
      case 'tactical':
        // Умный выбор
        if (hpPercent > 70) {
          return { action: ActionType.ATTACK, message: `${config.icon} ${config.name} агрессивно наступает!` };
        } else if (hpPercent > 30) {
          return { action: playerAction === ActionType.ATTACK ? ActionType.DEFEND : ActionType.ATTACK, message: `${config.icon} ${config.name} действует тактично!` };
        } else {
          return { action: ActionType.ATTACK, message: `${config.icon} ${config.name} в отчаянии!` };
        }
      
      default:
        return {
          action: ActionType.ATTACK,
          message: `${config.icon} ${config.name} атакует!`,
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
    
    // NEW BALANCE: Healing restrictions
    // - Max healing per turn: 8% of max HP
    // - Healing cooldown: 4 turns
    // - Total healing per fight: 20% of max HP
    
    let healAmount = 0;
    
    if (damageDealt !== undefined) {
      // Life drain - процент от урона
      healAmount = Math.floor(damageDealt * ability.heal_amount);
    } else {
      // Обычное исцеление - процент от текущего HP
      const healPercent = ability.heal_amount * (1 + Math.random()); // 0.05 * (1 to 2) = 5-10%
      healAmount = Math.max(1, Math.floor(boss.hp * healPercent));
    }
    
    // Cap single heal to 8% of max HP
    const maxSingleHeal = Math.floor(boss.maxHp * 0.08);
    healAmount = Math.min(healAmount, maxSingleHeal);
    
    return healAmount;
  }
}

export const bossSystem = new BossSystem();
