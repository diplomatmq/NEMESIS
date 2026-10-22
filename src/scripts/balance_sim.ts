/**
 * Balance simulation harness (Round 3, stage 4).
 *
 * The fights are executed by the real CombatEngine, not by a re-implementation
 * of its formulas. Only the world around the engine is modelled here: player
 * stats assembled the same way LootService.recalculateStats() does it, a
 * reasonable player policy, and the same enemy-action logic GameService uses.
 *
 * A seeded PRNG replaces Math.random so every run is reproducible.
 *
 * Run:  npx tsx src/scripts/balance_sim.ts
 */
import { combatEngine, Enemy } from '../game/CombatEngine';
import { bossSystem } from '../game/BossSystem';
import { classService } from '../game/ClassService';
import { SeededRandom } from '../game/SeededRandom';
import { ActionType } from '../types/game.types';
import { PlayerProgress } from '../database/models/PlayerProgress';

const SEASON_ID = 1;
const RUNS_PER_COMBO = Number(process.env.RUNS) || 5000;
const MAX_TURNS = 200;
const POTION_HEAL_FRACTION = 0.30;
const LOG_EVERY = Number(process.env.LOG_EVERY) || 0;

// Deterministic RNG installed over Math.random so the engine itself becomes
// reproducible.
let activeRng = new SeededRandom(1);
Math.random = () => activeRng.next();

type Slot = 'weapon' | 'shield' | 'armor' | 'helmet' | 'boots' | 'accessory';
const SLOTS: Slot[] = ['weapon', 'shield', 'armor', 'helmet', 'boots', 'accessory'];

interface CatalogueItem {
  name: string;
  slot: Slot;
  level: number;
  hp: number;
  atk: number;
  def: number;
  crit: number;
  dodge: number;
  ls: number;
  ai: number;
  /** Class affinity list; a matching class receives +5% attack synergy. */
  classes: string[];
  /** special_effect_code handled by SpecialEffects.ts. */
  effect?: string;
  /** Set for class_exclusive relics (usable by that class only). */
  exclusiveFor?: string;
}

const CLASS_BASE: Record<string, { hp: number; atk: number; def: number }> = {
  berserker: { hp: 120, atk: 15, def: 3 },
  guardian: { hp: 150, atk: 8, def: 12 },
  assassin: { hp: 90, atk: 12, def: 5 },
  vampire: { hp: 110, atk: 13, def: 6 },
  arcanist: { hp: 80, atk: 14, def: 4 },
  tactician: { hp: 100, atk: 10, def: 8 },
  jester: { hp: 95, atk: 11, def: 7 },
  necromancer: { hp: 85, atk: 9, def: 6 },
};

/**
 * Item catalogue transcribed from the migration files (002, 005, 016, 017,
 * 022, 027). Values are the final ones after every rebalance that touched the
 * row. `classes` mirrors `class_restricted`.
 */
const CATALOGUE: CatalogueItem[] = [
  // --- Weapons ---
  { name: 'Ржавый меч', slot: 'weapon', level: 1, hp: 0, atk: 5, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [] },
  { name: 'Короткий топор', slot: 'weapon', level: 1, hp: 0, atk: 16, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['berserker'], effect: '-2% DEF' },
  { name: 'Охотничий нож', slot: 'weapon', level: 1, hp: 0, atk: 12, def: 0, crit: 3, dodge: 0, ls: 0, ai: 0, classes: ['assassin'] },
  { name: 'Старый молот', slot: 'weapon', level: 1, hp: 0, atk: 20, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'], effect: '-5% recovery' },
  { name: 'Крушитель костей', slot: 'weapon', level: 5, hp: 0, atk: 30, def: 5, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['berserker', 'guardian'], effect: 'stun_damage' },
  { name: 'Игла Призрака', slot: 'weapon', level: 5, hp: 0, atk: 28, def: 0, crit: 4, dodge: 0, ls: 0, ai: 0, classes: ['assassin'], effect: 'armor_pierce' },
  { name: 'Посох душ', slot: 'weapon', level: 5, hp: 0, atk: 25, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['necromancer'], effect: 'summon_damage' },
  { name: 'Кровавый топор', slot: 'weapon', level: 5, hp: 0, atk: 45, def: 0, crit: 0, dodge: 0, ls: 3, ai: 0, classes: ['berserker', 'vampire'] },
  { name: 'Клинок охотника', slot: 'weapon', level: 5, hp: 0, atk: 35, def: 0, crit: 7, dodge: 0, ls: 0, ai: 0, classes: ['assassin'], effect: 'elite_damage' },
  { name: 'Клинок возмездия', slot: 'weapon', level: 10, hp: 0, atk: 55, def: 0, crit: 5, dodge: 0, ls: 0, ai: 0, classes: ['guardian', 'tactician'], effect: 'defend_attack_boost' },
  { name: 'Серп кровопийцы', slot: 'weapon', level: 10, hp: 0, atk: 45, def: 0, crit: 0, dodge: 0, ls: 5, ai: 0, classes: ['vampire'], effect: 'low_hp_lifesteal' },
  { name: 'Клинок палача', slot: 'weapon', level: 10, hp: 0, atk: 55, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['berserker'], effect: 'execute_damage' },
  { name: 'Катана тени', slot: 'weapon', level: 10, hp: 0, atk: 40, def: 0, crit: 0, dodge: 10, ls: 0, ai: 0, classes: ['assassin'], effect: 'after_defend_attack' },
  { name: 'Клинок вампира', slot: 'weapon', level: 10, hp: 0, atk: 70, def: 0, crit: 0, dodge: 0, ls: 7, ai: 0, classes: ['vampire'] },
  { name: 'Меч Бездны', slot: 'weapon', level: 10, hp: 0, atk: 85, def: 0, crit: 10, dodge: 0, ls: 0, ai: 0, classes: ['assassin', 'arcanist'], effect: 'ignore defense' },
  { name: 'Гримуар отражений', slot: 'weapon', level: 15, hp: 0, atk: 40, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['arcanist'], effect: 'reflect_boost' },
  { name: 'Клинок вероятности', slot: 'weapon', level: 15, hp: 0, atk: 50, def: 0, crit: 5, dodge: 0, ls: 0, ai: 0, classes: ['jester'], effect: 'crit_bonus' },
  { name: 'Посох Бездны', slot: 'weapon', level: 15, hp: 0, atk: 70, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['arcanist'], effect: 'ability_power' },
  { name: 'Меч берсерка', slot: 'weapon', level: 20, hp: 0, atk: 70, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['berserker'], effect: 'low_hp_attack' },
  { name: 'Молот последнего рубежа', slot: 'weapon', level: 25, hp: 0, atk: 60, def: 25, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian', 'berserker'], effect: 'low_hp_defense' },
  { name: 'Клык Дракона', slot: 'weapon', level: 30, hp: 0, atk: 120, def: 0, crit: 15, dodge: 0, ls: 0, ai: 0, classes: ['berserker', 'arcanist'], effect: 'critical_burn' },
  { name: 'Коса вечного слуги', slot: 'weapon', level: 30, hp: 0, atk: 70, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['necromancer'], effect: 'minion_return' },
  { name: 'Меч Короля', slot: 'weapon', level: 40, hp: 0, atk: 140, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'kill_next_attack' },
  { name: 'Раскалыватель времени', slot: 'weapon', level: 45, hp: 0, atk: 120, def: 0, crit: 8, dodge: 0, ls: 0, ai: 0, classes: ['tactician', 'arcanist'], effect: 'prediction_damage' },
  { name: 'Клинок Пустоты', slot: 'weapon', level: 50, hp: 0, atk: 160, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['jester', 'assassin'], effect: 'predicted_damage' },

  // --- Shields ---
  { name: 'Деревянный щит', slot: 'shield', level: 1, hp: 0, atk: 0, def: 3, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [] },
  { name: 'Щит стража', slot: 'shield', level: 1, hp: 30, atk: 0, def: 25, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [] },
  { name: 'Щит стражника', slot: 'shield', level: 1, hp: 0, atk: 0, def: 30, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'], effect: '+5% block' },
  { name: 'Щит последнего рубежа', slot: 'shield', level: 5, hp: 0, atk: 0, def: 60, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'], effect: 'last_stand_def' },
  { name: 'Зеркальный баклер', slot: 'shield', level: 10, hp: 0, atk: 0, def: 65, crit: 0, dodge: 3, ls: 0, ai: 0, classes: ['guardian', 'tactician'], effect: 'mirror_reflect' },
  { name: 'Башенный щит', slot: 'shield', level: 10, hp: 0, atk: 0, def: 55, crit: 0, dodge: -5, ls: 0, ai: 0, classes: ['guardian'] },
  { name: 'Щит живой стали', slot: 'shield', level: 15, hp: 0, atk: 0, def: 85, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'], effect: 'living_shield' },
  { name: 'Щит призрачного легиона', slot: 'shield', level: 15, hp: 100, atk: 0, def: 55, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['necromancer', 'guardian'], effect: 'minion_protection' },
  { name: 'Щит отражения', slot: 'shield', level: 15, hp: 0, atk: 0, def: 50, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'], effect: 'reflect_damage' },
  { name: 'Щит Бессмертного', slot: 'shield', level: 20, hp: 0, atk: 0, def: 80, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'], effect: 'perfect_block' },
  { name: 'Щит идеального момента', slot: 'shield', level: 30, hp: 0, atk: 0, def: 100, crit: 0, dodge: 0, ls: 0, ai: 3, classes: ['tactician', 'guardian'], effect: 'perfect_parry' },
  { name: 'Щит Падшего Архонта', slot: 'shield', level: 30, hp: 0, atk: 0, def: 75, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian', 'tactician'], effect: 'guard_counter' },
  { name: 'Эгида обратного удара', slot: 'shield', level: 45, hp: 150, atk: 0, def: 80, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian', 'jester'], effect: 'aegis_absorb' },
  { name: 'Щит Пустоты', slot: 'shield', level: 50, hp: 0, atk: 0, def: 80, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['jester', 'guardian'], effect: 'ability_block' },

  // --- Armor ---
  { name: 'Кожаная броня', slot: 'armor', level: 1, hp: 10, atk: 0, def: 5, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [] },
  { name: 'Старая кожаная броня', slot: 'armor', level: 1, hp: 80, atk: 0, def: 30, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [] },
  { name: 'Кольчуга ярости', slot: 'armor', level: 5, hp: 250, atk: 0, def: 25, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['berserker'], effect: 'rage_armor' },
  { name: 'Стальная броня', slot: 'armor', level: 10, hp: 280, atk: 0, def: 35, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'] },
  { name: 'Мантия теневого шага', slot: 'armor', level: 15, hp: 300, atk: 0, def: 30, crit: 0, dodge: 3, ls: 0, ai: 0, classes: ['assassin', 'jester'], effect: 'shadow_step' },
  { name: 'Доспех пожирателя душ', slot: 'armor', level: 15, hp: 350, atk: 0, def: 35, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['necromancer'], effect: 'soul_shield' },
  { name: 'Броня стражника', slot: 'armor', level: 15, hp: 400, atk: 0, def: 50, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'], effect: 'damage_reduction' },
  { name: 'Броня крови', slot: 'armor', level: 15, hp: 500, atk: 0, def: 40, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['vampire'], effect: 'attack_regeneration' },
  { name: 'Тяжёлая броня титана', slot: 'armor', level: 25, hp: 650, atk: 0, def: 80, crit: 0, dodge: -10, ls: 0, ai: 0, classes: ['guardian'] },
  { name: 'Броня Бездны', slot: 'armor', level: 25, hp: 750, atk: 0, def: 65, crit: 0, dodge: 0, ls: 0, ai: 5, classes: ['arcanist', 'jester'], effect: 'status_resistance' },
  { name: 'Мантия Архимага', slot: 'armor', level: 25, hp: 300, atk: 0, def: 20, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['arcanist'], effect: 'debuff_duration' },
  { name: 'Панцирь расколотого времени', slot: 'armor', level: 30, hp: 600, atk: 0, def: 65, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['tactician', 'arcanist'], effect: 'time_resist' },
  { name: 'Броня Короля', slot: 'armor', level: 40, hp: 1100, atk: 0, def: 120, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian', 'berserker'], effect: 'emergency_shield' },
  { name: 'Сердце каменного титана', slot: 'armor', level: 45, hp: 600, atk: 0, def: 60, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'], effect: 'titan_heart' },

  // --- Helmets ---
  { name: 'Кожаный капюшон', slot: 'helmet', level: 1, hp: 40, atk: 0, def: 5, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [] },
  { name: 'Железный шлем', slot: 'helmet', level: 1, hp: 80, atk: 0, def: 20, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [] },
  { name: 'Шлем охотника', slot: 'helmet', level: 5, hp: 50, atk: 0, def: 0, crit: 5, dodge: 0, ls: 0, ai: 0, classes: ['assassin'] },
  { name: 'Шлем берсерка', slot: 'helmet', level: 5, hp: 0, atk: 10, def: -5, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['berserker'] },
  { name: 'Маска последнего вздоха', slot: 'helmet', level: 5, hp: 100, atk: 0, def: 0, crit: 3, dodge: 0, ls: 0, ai: 0, classes: ['berserker', 'assassin'], effect: 'desperation_crit' },
  { name: 'Корона стражника', slot: 'helmet', level: 10, hp: 120, atk: 0, def: 30, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'] },
  { name: 'Корона Бездны', slot: 'helmet', level: 15, hp: 180, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 10, classes: ['jester', 'arcanist'] },
  { name: 'Венец предвидения', slot: 'helmet', level: 15, hp: 150, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 5, classes: ['tactician'], effect: 'foresight_def' },
  { name: 'Череп безмолвия', slot: 'helmet', level: 20, hp: 180, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['necromancer', 'arcanist'], effect: 'cc_reduction' },
  { name: 'Корона Архимага', slot: 'helmet', level: 25, hp: 160, atk: 20, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['arcanist'], effect: 'ability_power' },
  { name: 'Корона последнего шанса', slot: 'helmet', level: 30, hp: 250, atk: 0, def: 25, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian', 'berserker'], effect: 'last_hope' },

  // --- Boots ---
  { name: 'Старые сапоги', slot: 'boots', level: 1, hp: 0, atk: 0, def: 0, crit: 0, dodge: 2, ls: 0, ai: 0, classes: [] },
  { name: 'Сапоги охотника', slot: 'boots', level: 5, hp: 0, atk: 0, def: 0, crit: 3, dodge: 5, ls: 0, ai: 0, classes: ['assassin'] },
  { name: 'Сапоги контрудара', slot: 'boots', level: 5, hp: 100, atk: 0, def: 0, crit: 0, dodge: 2, ls: 0, ai: 0, classes: ['assassin'], effect: 'counter_strike' },
  { name: 'Железные сапоги', slot: 'boots', level: 5, hp: 60, atk: 0, def: 20, crit: 0, dodge: -5, ls: 0, ai: 0, classes: ['guardian'] },
  { name: 'Сапоги несгибаемости', slot: 'boots', level: 15, hp: 200, atk: 0, def: 20, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian', 'berserker'], effect: 'slow_resist' },
  { name: 'Сапоги Пустоты', slot: 'boots', level: 20, hp: 0, atk: 0, def: 0, crit: 0, dodge: 12, ls: 0, ai: 5, classes: ['jester', 'assassin'], effect: 'ability_evasion' },
  { name: 'Сапоги призрачной поступи', slot: 'boots', level: 20, hp: 0, atk: 0, def: 0, crit: 0, dodge: 5, ls: 0, ai: 3, classes: ['jester', 'assassin'], effect: 'first_strike_dodge' },
  { name: 'Хроносапоги возмездия', slot: 'boots', level: 30, hp: 250, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['tactician'], effect: 'time_strike' },

  // --- Accessories ---
  { name: 'Кольцо жизненной силы', slot: 'accessory', level: 1, hp: 150, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [] },
  { name: 'Кольцо силы', slot: 'accessory', level: 1, hp: 0, atk: 30, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [] },
  { name: 'Кольцо стойкости', slot: 'accessory', level: 1, hp: 0, atk: 0, def: 50, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [] },
  { name: 'Амулет регенерации', slot: 'accessory', level: 5, hp: 0, atk: 0, def: 0, crit: 0, dodge: 0, ls: 1, ai: 0, classes: [], effect: 'regeneration' },
  { name: 'Медальон ярости', slot: 'accessory', level: 5, hp: 0, atk: 35, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['berserker'], effect: 'fury_medallion' },
  { name: 'Кольцо отражённой боли', slot: 'accessory', level: 5, hp: 0, atk: 0, def: 20, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian', 'vampire'], effect: 'reflect_ring' },
  { name: 'Подвеска призрачного шага', slot: 'accessory', level: 5, hp: 100, atk: 0, def: 0, crit: 0, dodge: 3, ls: 0, ai: 0, classes: ['assassin'], effect: 'ghost_pendant' },
  { name: 'Сердце Титана', slot: 'accessory', level: 10, hp: 480, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'] },
  { name: 'Амулет стражника', slot: 'accessory', level: 10, hp: 200, atk: 0, def: 65, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'] },
  { name: 'Амулет разрушения', slot: 'accessory', level: 10, hp: 0, atk: 70, def: -5, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['berserker', 'assassin'] },
  { name: 'Кинжал Отчаяния', slot: 'accessory', level: 10, hp: 0, atk: 40, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['berserker', 'assassin'], effect: 'low_hp_crit' },
  { name: 'Плащ Тени', slot: 'accessory', level: 10, hp: 0, atk: 0, def: 0, crit: 0, dodge: 10, ls: 0, ai: 0, classes: ['assassin'], effect: 'defend_dodge' },
  { name: 'Глаз Ведьмы', slot: 'accessory', level: 10, hp: 0, atk: 0, def: 0, crit: 10, dodge: 0, ls: 0, ai: 10, classes: ['arcanist', 'jester'], effect: 'warn_ability' },
  { name: 'Сломанные часы', slot: 'accessory', level: 10, hp: 0, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['tactician'], effect: 'extra_action' },
  { name: 'Амулет накопленной силы', slot: 'accessory', level: 10, hp: 0, atk: 25, def: 20, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['tactician', 'guardian'], effect: 'charge_amulet' },
  { name: 'Сердце Дракона', slot: 'accessory', level: 15, hp: 0, atk: 70, def: 0, crit: 5, dodge: 0, ls: 0, ai: 0, classes: [] },
  { name: 'Камень Титана', slot: 'accessory', level: 15, hp: 0, atk: 0, def: 100, crit: 0, dodge: -5, ls: 0, ai: 0, classes: ['guardian'] },
  { name: 'Амулет Мученика', slot: 'accessory', level: 15, hp: 320, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian', 'berserker'], effect: 'damage_to_attack' },
  { name: 'Маска Мертвеца', slot: 'accessory', level: 15, hp: 0, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 15, classes: ['jester'], effect: 'hide_last_action' },
  { name: 'Кость удачи', slot: 'accessory', level: 15, hp: 0, atk: 0, def: 0, crit: 4, dodge: 3, ls: 0, ai: 0, classes: ['jester'], effect: 'lucky_bone' },
  { name: 'Печать кровавой клятвы', slot: 'accessory', level: 15, hp: 200, atk: 50, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['vampire'], effect: 'blood_seal' },
  { name: 'Око поглощения', slot: 'accessory', level: 15, hp: 150, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['arcanist'], effect: 'absorption_eye' },
  { name: 'Сердце Феникса', slot: 'accessory', level: 20, hp: 320, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'revive' },
  { name: 'Жетон бессмертного слуги', slot: 'accessory', level: 20, hp: 200, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['necromancer'], effect: 'immortal_servant' },
  { name: 'Кровавое сердце', slot: 'accessory', level: 25, hp: 640, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['berserker', 'vampire'], effect: 'lost_hp_attack' },
  { name: 'Сердце крепости', slot: 'accessory', level: 25, hp: 0, atk: 0, def: 100, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian'], effect: 'first_hit_reduction' },
  { name: 'Сердце идеального парирования', slot: 'accessory', level: 30, hp: 100, atk: 0, def: 50, crit: 0, dodge: 0, ls: 0, ai: 0, classes: ['guardian', 'tactician'], effect: 'parry_heart' },
  { name: 'Часы последнего шанса', slot: 'accessory', level: 35, hp: 300, atk: 0, def: 0, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'last_chance' },
  { name: 'Корона Безумного Короля', slot: 'accessory', level: 40, hp: 320, atk: 65, def: 65, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'changing_bonus' },
  { name: 'Печать восьми судеб', slot: 'accessory', level: 45, hp: 250, atk: 50, def: 50, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'eight_fates' },

  // --- Class exclusive relics (legendary accessories) ---
  { name: 'Сердце Ярости', slot: 'accessory', level: 1, hp: 150, atk: 20, def: 10, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'rage', exclusiveFor: 'berserker' },
  { name: 'Ядро Стойкости', slot: 'accessory', level: 1, hp: 150, atk: 20, def: 10, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'fortress', exclusiveFor: 'guardian' },
  { name: 'Клинок Безымянного', slot: 'accessory', level: 1, hp: 150, atk: 20, def: 10, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'unrepeated_crit', exclusiveFor: 'assassin' },
  { name: 'Клык Первого Вампира', slot: 'accessory', level: 1, hp: 150, atk: 20, def: 10, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'ancient_lifesteal', exclusiveFor: 'vampire' },
  { name: 'Фокус Архимага', slot: 'accessory', level: 1, hp: 150, atk: 20, def: 10, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'spell_amplification', exclusiveFor: 'arcanist' },
  { name: 'Компас Стратега', slot: 'accessory', level: 1, hp: 150, atk: 20, def: 10, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'sequence_mastery', exclusiveFor: 'tactician' },
  { name: 'Маска Хаоса', slot: 'accessory', level: 1, hp: 150, atk: 20, def: 10, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'ai_chaos', exclusiveFor: 'jester' },
  { name: 'Череп Повелителя Мёртвых', slot: 'accessory', level: 1, hp: 150, atk: 20, def: 10, crit: 0, dodge: 0, ls: 0, ai: 0, classes: [], effect: 'summon', exclusiveFor: 'necromancer' },
];

type BuildName = 'нет экип.' | 'урон' | 'танк' | 'гибрид' | 'синергия';
const BUILDS: BuildName[] = ['нет экип.', 'урон', 'танк', 'гибрид', 'синергия'];

const CLASSES = ['berserker', 'guardian', 'assassin', 'vampire', 'arcanist', 'tactician', 'jester', 'necromancer'];

function scoreItem(item: CatalogueItem, build: BuildName, cls: string): number {
  const base =
    item.hp * 0.2 + item.atk * 1.5 + item.def * 1.5 + item.crit * 3 + item.dodge * 2 + item.ls * 1 + item.ai * 0.5;
  switch (build) {
    case 'урон':
      return item.hp * 0.05 + item.atk * 3 + item.def * 0.2 + item.crit * 6 + item.dodge * 2 + item.ls * 2 + item.ai * 0.5;
    case 'танк':
      return item.hp * 0.4 + item.atk * 0.2 + item.def * 4 + item.dodge * 3 + item.crit * 1 + item.ls * 0.5;
    case 'гибрид':
      return base;
    case 'синергия': {
      if (item.exclusiveFor && item.exclusiveFor !== cls) return -Infinity;
      let bonus = 0;
      if (item.classes.includes(cls)) bonus += 1000;
      if (item.exclusiveFor === cls) bonus += 500;
      return base + bonus;
    }
    default:
      return -Infinity;
  }
}

interface PlayerSetup {
  stats: { maxHp: number; atk: number; def: number; crit: number; dodge: number; ls: number; ai: number };
  effects: string[];
  items: string[];
}

/**
 * Assembles player stats exactly like LootService.recalculateStats(): flat
 * bonuses are summed first, then the summed class synergy percentage is
 * applied once.
 */
function buildPlayer(cls: string, floor: number, build: BuildName): PlayerSetup {
  const level = Math.floor(floor / 10);
  const base = CLASS_BASE[cls];

  if (build === 'нет экип.') {
    return {
      stats: { maxHp: base.hp, atk: base.atk, def: base.def, crit: 0, dodge: 0, ls: 0, ai: 0 },
      effects: [],
      items: [],
    };
  }

  let hp = base.hp;
  let atk = base.atk;
  let def = base.def;
  let crit = 0;
  let dodge = 0;
  let ls = 0;
  let ai = 0;
  let atkPercent = 0;
  const effects: string[] = [];
  const items: string[] = [];

  for (const slot of SLOTS) {
    const candidates = CATALOGUE.filter((i) => i.slot === slot && i.level <= level);
    let best: CatalogueItem | undefined;
    let bestScore = 0;
    for (const item of candidates) {
      const score = scoreItem(item, build, cls);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    if (!best) continue;
    items.push(best.name);
    hp += best.hp;
    atk += best.atk;
    def += best.def;
    crit += best.crit;
    dodge += best.dodge;
    ls += best.ls;
    ai += best.ai;
    if (best.effect) effects.push(best.effect);
    if (best.classes.includes(cls)) atkPercent += 5;
  }

  return {
    stats: {
      maxHp: hp,
      atk: Math.floor(atk * (1 + atkPercent / 100)),
      def,
      crit,
      dodge,
      ls,
      ai,
    },
    effects,
    items,
  };
}

function makePlayer(cls: string, setup: PlayerSetup): PlayerProgress {
  const progress: Partial<PlayerProgress> = {
    id: 1,
    user_id: 1,
    season_id: SEASON_ID,
    floor: 1,
    highest_floor_reached: 1,
    hp: setup.stats.maxHp,
    max_hp: setup.stats.maxHp,
    attack: setup.stats.atk,
    defense: setup.stats.def,
    crit_chance: setup.stats.crit,
    dodge: setup.stats.dodge,
    lifesteal: setup.stats.ls,
    ai_resist: setup.stats.ai,
    equipment_effects: setup.effects,
    gold: 0,
    xp: 0,
    level: 1,
    checkpoint_floor: 1,
    trail_modifier: 1,
    necro_mob_souls: cls === 'necromancer' ? 3 : 0,
    necro_boss_souls: cls === 'necromancer' ? [{ name: 'Тестовый босс', floor: 1 }] : [],
    necro_debuff_games: 0,
    necro_attack_bonus: 0,
    necro_defense_bonus: 0,
    necro_bonus_games: 0,
    created_at: new Date(),
    updated_at: new Date(),
  };
  return progress as PlayerProgress;
}

const CLASS_MARKERS: Record<string, string> = {
  berserker: 'Берсерк:',
  guardian: 'Страж:',
  assassin: 'Ассасин:',
  vampire: 'Вампир:',
  arcanist: 'Арканист:',
  tactician: 'Тактик:',
  jester: 'Шут:',
  necromancer: 'Некромант:',
};

interface ComboStats {
  wins: number;
  losses: number;
  timeouts: number;
  turns: number[];
  attacks: number;
  defends: number;
  classAbilityTurns: number;
  totalTurns: number;
  potionFights: number;
  deathsBeforeFirstHit: number;
  remainingHpOnWin: number[];
}

function newStats(): ComboStats {
  return {
    wins: 0, losses: 0, timeouts: 0, turns: [], attacks: 0, defends: 0,
    classAbilityTurns: 0, totalTurns: 0, potionFights: 0, deathsBeforeFirstHit: 0,
    remainingHpOnWin: [],
  };
}

function aiAccuracy(floor: number, aiResist: number): number {
  let base: number;
  if (floor <= 10) base = 0.2;
  else if (floor <= 30) base = 0.5;
  else if (floor <= 60) base = 0.7;
  else if (floor <= 100) base = 0.8;
  else base = 0.9;
  return Math.max(0.1, base - aiResist / 100);
}

function rollEnemyAction(forecast: ActionType): ActionType {
  const attackWeight = forecast === ActionType.ATTACK ? 2 : 1;
  const defendWeight = forecast === ActionType.DEFEND ? 2 : 1;
  return Math.random() * (attackWeight + defendWeight) < attackWeight ? ActionType.ATTACK : ActionType.DEFEND;
}

async function simulateFight(cls: string, floor: number, setup: PlayerSetup, stats: ComboStats): Promise<void> {
  const player = makePlayer(cls, setup);
  const enemy: Enemy = bossSystem.generateBossEnemy(floor, SEASON_ID);

  // Necromancer summons support on 85% of fights when souls are available.
  if (cls === 'necromancer' && Math.random() < 0.85) {
    const hasBoss = enemy && player.necro_boss_souls.length > 0;
    const summonBoss = hasBoss && Math.random() < 0.7;
    if (summonBoss) {
      enemy.summonedSupport = 'boss';
      enemy.summonedSupportName = player.necro_boss_souls[0].name;
    } else if (player.necro_mob_souls >= 3) {
      enemy.summonedSupport = 'mobs';
      enemy.summonedSupportName = 'Три призванных мертвеца';
    }
  }

  const maxHp = player.max_hp;
  const potionHeal = Math.floor(maxHp * POTION_HEAL_FRACTION);
  let potionUsed = false;
  let anyPotion = false;
  let turns = 0;
  let dealtDamage = false;
  let diedBeforeFirstHit = false;
  let classAbilityUsed = false;
  let lastAction: ActionType | undefined;

  while (enemy.hp > 0 && player.hp > 0 && turns < MAX_TURNS) {
    turns++;

    // Potion: once per fight, does not consume the combat turn.
    if (!potionUsed && player.hp / maxHp < 0.30) {
      player.hp = Math.min(maxHp, player.hp + potionHeal);
      potionUsed = true;
      anyPotion = true;
    }

    // Reasonable player policy that uses the DEFEND -> ATTACK synergy:
    // defend while hurt, but never twice in a row (that would only waste the
    // stored charge and stall the fight forever), otherwise attack.
    const hpFrac = player.hp / maxHp;
    const action = (hpFrac < 0.40 && lastAction !== ActionType.DEFEND) || Math.random() < 0.15
      ? ActionType.DEFEND
      : ActionType.ATTACK;
    lastAction = action;
    if (action === ActionType.ATTACK) stats.attacks++;
    else stats.defends++;

    // Same forecast logic as GameService.
    const accuracy = aiAccuracy(floor, player.ai_resist);
    let predictedEnemyAction: ActionType | undefined;
    if (floor > 10) {
      const playerActionGuess = Math.random() < accuracy ? action : (action === ActionType.ATTACK ? ActionType.DEFEND : ActionType.ATTACK);
      predictedEnemyAction = playerActionGuess === ActionType.ATTACK ? ActionType.DEFEND : ActionType.ATTACK;
    }
    const enemyAction = predictedEnemyAction !== undefined
      ? rollEnemyAction(predictedEnemyAction)
      : (Math.random() > 0.5 ? ActionType.ATTACK : ActionType.DEFEND);

    const result = await combatEngine.executeCombat(
      player, enemy, action, enemyAction, cls, predictedEnemyAction
    );

    enemy.hp = result.enemyHp;
    player.hp = result.playerHp;

    if (result.playerDamage > 0) dealtDamage = true;
    if (result.playerDefeated && !dealtDamage) diedBeforeFirstHit = true;
    if (result.message.includes(CLASS_MARKERS[cls])) classAbilityUsed = true;

    if (result.enemyDefeated || result.playerDefeated) break;
  }

  stats.turns.push(turns);
  stats.totalTurns += turns;
  if (classAbilityUsed) stats.classAbilityTurns++;
  if (anyPotion) stats.potionFights++;
  if (diedBeforeFirstHit) stats.deathsBeforeFirstHit++;
  if (enemy.hp <= 0) {
    stats.wins++;
    stats.remainingHpOnWin.push(player.hp / maxHp);
  } else if (player.hp <= 0) {
    stats.losses++;
  } else {
    stats.timeouts++;
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : (part / total) * 100;
}

interface ComboResult {
  floor: number;
  cls: string;
  build: BuildName;
  stats: ComboStats;
}

const FLOORS = process.env.FLOORS
  ? process.env.FLOORS.split(',').map((f) => Number(f.trim()))
  : [10, 50, 100, 150, 200, 300, 400, 500];

async function main(): Promise<void> {
  const results: ComboResult[] = [];
  const started = Date.now();

  for (const floor of FLOORS) {
    const boss = bossSystem.getBossConfigS1(floor, SEASON_ID);
    console.log(`\n${'='.repeat(110)}`);
    console.log(`ЭТАЖ ${floor} (ур. ${Math.floor(floor / 10)}) — босс ${boss.name} | HP ${boss.base_hp} ATK ${boss.base_attack} DEF ${boss.base_defense}`);
    console.log('='.repeat(110));

    for (const cls of CLASSES) {
      for (const build of BUILDS) {
        activeRng = new SeededRandom(floor * 100003 + CLASSES.indexOf(cls) * 1009 + BUILDS.indexOf(build) * 97 + 7);
        const setup = buildPlayer(cls, floor, build);
        if (process.env.SHOW_STATS && (build === 'урон' || build === 'танк' || build === 'синергия')) {
          const s = setup.stats;
          console.log(
            `  [stats] ${cls.padEnd(12)} ${build.padEnd(10)} HP ${String(s.maxHp).padStart(5)}`
            + ` ATK ${String(s.atk).padStart(4)} DEF ${String(s.def).padStart(4)}`
            + ` crit ${s.crit} dodge ${s.dodge} ls ${s.ls} ai ${s.ai}`
          );
        }
        const stats = newStats();
        for (let run = 0; run < RUNS_PER_COMBO; run++) {
          await simulateFight(cls, floor, setup, stats);
        }
        results.push({ floor, cls, build, stats });

        const total = RUNS_PER_COMBO;
        const avgRemaining = stats.remainingHpOnWin.length
          ? stats.remainingHpOnWin.reduce((a, b) => a + b, 0) / stats.remainingHpOnWin.length
          : 0;
        console.log(
          `${cls.padEnd(12)}| ${build.padEnd(10)}| win ${pct(stats.wins, total).toFixed(1).padStart(5)}%`
          + ` | loss ${pct(stats.losses, total).toFixed(1).padStart(5)}%`
          + ` | TO ${pct(stats.timeouts, total).toFixed(1).padStart(4)}%`
          + ` | turns ${(stats.turns.reduce((a, b) => a + b, 0) / total).toFixed(1).padStart(5)}/${median(stats.turns).toFixed(0).padStart(4)}`
          + ` | atk ${(stats.attacks / total).toFixed(1).padStart(5)} def ${(stats.defends / total).toFixed(1).padStart(5)}`
          + ` | hp ${(avgRemaining * 100).toFixed(0).padStart(3)}%`
          + ` | cls ${pct(stats.classAbilityTurns, total).toFixed(0).padStart(3)}%`
          + ` | pot ${pct(stats.potionFights, total).toFixed(0).padStart(3)}%`
          + ` | death1 ${pct(stats.deathsBeforeFirstHit, total).toFixed(1).padStart(5)}%`
        );
      }
    }
  }

  // Anomaly summary.
  console.log(`\n${'='.repeat(110)}`);
  console.log('АНОМАЛИИ');
  console.log('='.repeat(110));
  const guaranteed = results.filter((r) => r.stats.wins === RUNS_PER_COMBO);
  const impossible = results.filter((r) => pct(r.stats.wins, RUNS_PER_COMBO) < 20 && r.build !== 'нет экип.');
  const timeouts = results.filter((r) => r.stats.timeouts > 0);
  console.log(`Гарантированные победы (100%): ${guaranteed.length}`);
  for (const r of guaranteed) console.log(`  этаж ${r.floor} | ${r.cls} | ${r.build}`);
  console.log(`Провалы ниже 20% (с экипировкой): ${impossible.length}`);
  for (const r of impossible) {
    console.log(`  этаж ${r.floor} | ${r.cls} | ${r.build} → ${pct(r.stats.wins, RUNS_PER_COMBO).toFixed(1)}%`);
  }
  console.log(`Таймауты (>${MAX_TURNS} ходов): ${timeouts.length}`);
  for (const r of timeouts) {
    console.log(`  этаж ${r.floor} | ${r.cls} | ${r.build} → ${pct(r.stats.timeouts, RUNS_PER_COMBO).toFixed(1)}%`);
  }

  console.log(`\nГотово за ${((Date.now() - started) / 1000).toFixed(1)} с.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
