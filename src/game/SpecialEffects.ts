import { ActionType } from '../types/game.types';

/**
 * Combat handlers for the `special_effect_code` of equipped items.
 *
 * Effects that reference systems the game does not model (freeze, stun,
 * silence, magic power, energy, cooldowns) are mapped onto the closest
 * mechanic that does exist so every item does something in combat.
 */

export interface EffectContext {
  effects: string[];
  playerHp: number;
  playerMaxHp: number;
  enemyHp: number;
  enemyMaxHp: number;
  isBoss: boolean;
  playerAction: ActionType;
  enemyAction: ActionType;
  isCrit: boolean;
  predictionCorrect: boolean;
  hasMinion: boolean;
  turnCount: number;
  usedOnce: string[];
}

export interface AttackEffectReport {
  damageMultiplier: number;
  critChanceBonus: number;
  defensePierce: number;
  lifestealBonus: number;
  healPercent: number;
  messages: string[];
}

export interface DefenseEffectReport {
  damageReduction: number;
  blockChance: number;
  fullBlockChance: number;
  dodgeBonus: number;
  healPercent: number;
  reflectPercent: number;
  nextAttackBonusPercent: number;
  messages: string[];
}

export interface IncomingEffectReport {
  reduction: number;
  absorbFlat: number;
  preventLethal: boolean;
  revive: boolean;
  messages: string[];
}

export interface DodgeEffectReport {
  healPercent: number;
  nextAttackBonusPercent: number;
  messages: string[];
}

const MAX_TOTAL_REDUCTION = 0.75;

export class SpecialEffectsService {
  private has(ctx: EffectContext, code: string): boolean {
    return ctx.effects.includes(code);
  }

  private hpPercent(ctx: EffectContext): number {
    return (ctx.playerHp / ctx.playerMaxHp) * 100;
  }

  private missingHpFraction(ctx: EffectContext): number {
    return 1 - ctx.playerHp / ctx.playerMaxHp;
  }

  analyzeAttack(ctx: EffectContext): AttackEffectReport {
    const report: AttackEffectReport = {
      damageMultiplier: 1,
      critChanceBonus: 0,
      defensePierce: 0,
      lifestealBonus: 0,
      healPercent: 0,
      messages: [],
    };
    const hp = this.hpPercent(ctx);
    const enemyHp = (ctx.enemyHp / ctx.enemyMaxHp) * 100;
    const multiply = (factor: number, message?: string) => {
      report.damageMultiplier *= factor;
      if (message) report.messages.push(message);
    };

    if (this.has(ctx, 'low_hp_damage') && hp < 50) {
      multiply(1.10, '🔥 Клык Берсерка: ярость крови +10% урона!');
    }
    if (this.has(ctx, 'low_hp_attack') && hp < 50) {
      multiply(1.15, '⚔️ Меч берсерка: сила растёт с раной +15% урона!');
    }
    if (this.has(ctx, 'rage') && hp < 50) {
      multiply(1.15, '❤️ Сердце Ярости: +15% урона!');
    }
    if (this.has(ctx, 'fury_medallion') && hp < 50) {
      multiply(1.05, '🏅 Медальон ярости: +5% урона!');
    }
    if (this.has(ctx, 'rage_armor') && hp < 40) {
      multiply(1.05, '⛓ Кольчуга ярости: +5% атаки!');
    }
    if (this.has(ctx, 'lost_hp_attack')) {
      const bonus = Math.floor(20 * this.missingHpFraction(ctx));
      if (bonus > 0) {
        multiply(1 + bonus / 100, `🩸 Кровавое сердце: +${bonus}% урона от потерь!`);
      }
    }
    if (this.has(ctx, 'damage_to_attack')) {
      const bonus = Math.floor(15 * this.missingHpFraction(ctx));
      if (bonus > 0) {
        multiply(1 + bonus / 100, `✝️ Амулет Мученика: +${bonus}% урона!`);
      }
    }
    if (this.has(ctx, 'execute_damage') && enemyHp < 30) {
      multiply(1.20, '🪓 Клинок палача: +20% урона ослабленному врагу!');
    }
    if (this.has(ctx, 'elite_damage') && ctx.isBoss) {
      multiply(1.07, '🎯 +7% урона боссу!');
    }
    if (this.has(ctx, 'stun_damage') && ctx.isBoss) {
      multiply(1.08, '🦴 Крушитель костей: +8% урона!');
    }
    if (this.has(ctx, 'kill_next_attack')) {
      multiply(1.15, '👑 Меч Короля: +15% урона!');
    }
    if (this.has(ctx, 'spell_amplification')) {
      multiply(1.12, '🔮 Фокус Архимага: +12% урона!');
    }
    if (this.has(ctx, 'ability_power')) {
      multiply(1.10, '📜 +10% силы способностей!');
    }
    if (this.has(ctx, 'debuff_duration')) {
      multiply(1.08, '🧙 Мантия Архимага: +8% силы эффектов!');
    }
    if (this.has(ctx, 'summon') && ctx.hasMinion) {
      multiply(1.15, '💀 Череп Повелителя: миньоны +15% урона!');
    }
    if (this.has(ctx, 'summon_damage')) {
      multiply(1.08, '🔱 Посох душ: призывы +8% урона!');
    }
    if (this.has(ctx, 'minion_return')) {
      multiply(1.10, '⚰️ Коса вечного слуги: +10% урона!');
    }
    if (ctx.predictionCorrect && this.has(ctx, 'predicted_damage')) {
      multiply(1.30, '🧠 Клинок Пустоты: +30% урона за верный прогноз!');
    }
    if (ctx.predictionCorrect && this.has(ctx, 'prediction_damage')) {
      multiply(1.20, '⏳ Раскалыватель времени: +20% урона за предугадывание!');
    }
    if (ctx.predictionCorrect && this.has(ctx, 'sequence_mastery')) {
      multiply(1.15, '🧭 Компас Стратега: +15% урона!');
    }
    if (this.has(ctx, 'critical_burn') && ctx.isCrit) {
      multiply(1.20, '🔥 Критический ожог: +20% урона!');
    }
    if (this.has(ctx, 'crit_bonus') && ctx.isCrit) {
      multiply(1.25, '🎲 Клинок вероятности: +25% урона при крите!');
    }
    if (this.has(ctx, 'greed')) {
      multiply(1.15, '💰 Кольцо Жадности: +15% урона!');
    }
    if (this.has(ctx, 'time_strike')) {
      multiply(1.05, '⏱ Хроносапоги: +5% урона!');
    }
    if (this.has(ctx, 'charge_amulet')) {
      multiply(1.05, '🔋 Амулет накопленной силы: +5% урона!');
    }
    if (this.has(ctx, 'extra_action')) {
      multiply(1.05, '🕰 Сломанные часы: +5% урона!');
    }
    if (this.has(ctx, 'eight_fates')) {
      multiply(1.05, '🎴 Печать восьми судеб: +5% урона!');
    }
    if (this.has(ctx, 'lucky_bone')) {
      multiply(1.05, '🍀 Кость удачи: +5% урона!');
    }
    if (this.has(ctx, 'changing_bonus')) {
      const factor = 0.90 + Math.random() * 0.25;
      multiply(factor, `🎭 Меняющийся бонус: ×${factor.toFixed(2)} урона!`);
    }
    if (this.has(ctx, 'ai_chaos')) {
      const factor = 0.85 + Math.random() * 0.40;
      multiply(factor, `🌀 Маска Хаоса: ×${factor.toFixed(2)} урона!`);
    }

    if (this.has(ctx, 'low_hp_crit') && hp < 30) {
      report.critChanceBonus += 10;
      report.messages.push('🗡 Кинжал Отчаяния: +10% шанса крита!');
    }
    if (this.has(ctx, 'desperation_crit') && hp < 25) {
      report.critChanceBonus += 5;
      report.messages.push('💀 Маска последнего вздоха: +5% крита!');
    }
    if (this.has(ctx, 'unrepeated_crit')) {
      report.critChanceBonus += 5;
      report.messages.push('⚡ Клинок Безымянного: +5% крита!');
    }

    if (this.has(ctx, 'ignore defense') && ctx.isBoss) {
      report.defensePierce = Math.max(report.defensePierce, 0.10);
    }
    if (this.has(ctx, 'armor_pierce') && ctx.isBoss) {
      report.defensePierce = Math.max(report.defensePierce, 0.05);
    }

    if (this.has(ctx, 'ancient_lifesteal')) {
      report.lifestealBonus += 0.10;
      report.messages.push('🩸 Древний вампиризм: +10% вампиризма!');
    }
    if (this.has(ctx, 'blood_seal')) {
      report.lifestealBonus += 0.10;
      report.messages.push('🩸 Печать кровавой клятвы: +10% вампиризма!');
    }
    if (this.has(ctx, 'low_hp_lifesteal') && hp < 40) {
      report.lifestealBonus += 0.10;
      report.messages.push('🩸 Серп кровопийцы: +10% лечения!');
    }
    if (this.has(ctx, 'attack_regeneration')) {
      report.healPercent += 0.02;
    }

    return report;
  }

  analyzeDefense(ctx: EffectContext, predictionCorrect: boolean): DefenseEffectReport {
    const report: DefenseEffectReport = {
      damageReduction: 0,
      blockChance: 0,
      fullBlockChance: 0,
      dodgeBonus: 0,
      healPercent: 0,
      reflectPercent: 0,
      nextAttackBonusPercent: 0,
      messages: [],
    };
    const hp = this.hpPercent(ctx);

    if (this.has(ctx, 'damage_reduction')) {
      report.damageReduction += 0.03;
      report.messages.push('🛡 Броня стражника: -3% урона!');
    }
    if (this.has(ctx, 'fortress')) {
      report.damageReduction += 0.05;
      report.messages.push('🏰 Ядро Стойкости: -5% урона!');
    }
    if (this.has(ctx, 'time_resist')) {
      report.damageReduction += 0.05;
      report.messages.push('⏳ Панцирь времени: -5% урона!');
    }
    if (this.has(ctx, 'last_stand_def') && hp < 25) {
      report.damageReduction += 0.05;
      report.messages.push('🛡 Щит последнего рубежа: -5% урона!');
    }
    if (this.has(ctx, 'low_hp_defense') && hp < 30) {
      report.damageReduction += 0.08;
      report.messages.push('🔨 Молот последнего рубежа: -8% урона!');
    }
    if (this.has(ctx, 'first_hit_reduction') && ctx.turnCount <= 1) {
      report.damageReduction += 0.50;
      report.messages.push('❤️ Сердце крепости: первый удар -50%!');
    }
    if (this.has(ctx, 'minion_protection') && ctx.hasMinion) {
      report.damageReduction += 0.05;
      report.messages.push('💀 Щит призрачного легиона: -5% урона!');
    }
    if (this.has(ctx, 'cc_reduction')) {
      report.damageReduction += 0.03;
      report.messages.push('💀 Череп безмолвия: -3% урона!');
    }
    if (this.has(ctx, 'slow_resist')) {
      report.damageReduction += 0.03;
      report.messages.push('🥾 Сапоги несгибаемости: -3% урона!');
    }

    if (this.has(ctx, '+5% block') || this.has(ctx, 'block')) {
      report.blockChance += 0.05;
      report.messages.push('🛡 Щит стражника: +5% блока!');
    }
    if (this.has(ctx, 'perfect_block')) {
      report.fullBlockChance += 0.08;
      report.messages.push('✨ Щит Бессмертного: шанс полного блока!');
    }
    if (this.has(ctx, 'perfect_parry')) {
      report.nextAttackBonusPercent += 0.15;
      report.messages.push('🛡 Щит идеального момента: +15% к следующей атаке!');
    }
    if (this.has(ctx, 'defend_dodge')) {
      report.dodgeBonus += 0.20;
      report.messages.push('🌫 Плащ Тени: +20% уклонения после защиты!');
    }
    if (this.has(ctx, 'shadow_step')) {
      report.dodgeBonus += 0.05;
    }
    if (this.has(ctx, 'first_strike_dodge') && ctx.isBoss && ctx.turnCount <= 1) {
      report.dodgeBonus += 0.10;
      report.messages.push('👻 Сапоги призрачной поступи: +10% уклонения!');
    }

    if (this.has(ctx, 'living_shield')) {
      report.healPercent += 0.02;
      report.messages.push('🪨 Щит живой стали: +2% HP!');
    }
    if (this.has(ctx, 'parry_heart')) {
      report.healPercent += 0.03;
      report.messages.push('❤ Сердце парирования: +3% HP!');
    }

    if (this.has(ctx, 'reflect_damage')) {
      report.reflectPercent += 0.10;
      report.messages.push('🪞 Щит отражения: 10% урона отражено!');
    }
    if (this.has(ctx, 'reflect_ring')) {
      report.reflectPercent += 0.05;
      report.messages.push('💍 Кольцо отражённой боли: 5% урона отражено!');
    }
    if (this.has(ctx, 'mirror_reflect')) {
      report.reflectPercent += 0.15;
      report.messages.push('🪞 Зеркальный баклер: 15% урона отражено!');
    }
    if (this.has(ctx, 'reflect_boost')) {
      report.reflectPercent += 0.10;
    }

    if (this.has(ctx, 'counter_attack')) {
      report.nextAttackBonusPercent += 0.10;
    }
    if (this.has(ctx, 'guard_counter')) {
      report.nextAttackBonusPercent += 0.30;
    }
    if (this.has(ctx, 'after_defend_attack')) {
      report.nextAttackBonusPercent += 0.15;
    }
    if (this.has(ctx, 'defend_attack_boost')) {
      report.nextAttackBonusPercent += 0.15;
    }
    if (this.has(ctx, 'counter_strike')) {
      report.nextAttackBonusPercent += 0.05;
    }
    if (predictionCorrect && this.has(ctx, 'foresight_def')) {
      report.damageReduction += 0.05;
      report.messages.push('👁 Венец предвидения: -5% урона за верный прогноз!');
    }
    if (predictionCorrect && this.has(ctx, 'time_resist')) {
      report.damageReduction += 0.05;
    }

    return report;
  }

  onDodge(ctx: EffectContext): DodgeEffectReport {
    const report: DodgeEffectReport = { healPercent: 0, nextAttackBonusPercent: 0, messages: [] };
    if (this.has(ctx, 'ghost_pendant')) {
      report.healPercent += 0.02;
      report.messages.push('👻 Подвеска призрачного шага: +2% HP после уклонения!');
    }
    if (this.has(ctx, 'shadow_step')) {
      report.nextAttackBonusPercent += 0.05;
      report.messages.push('🌫 Мантия теневого шага: +5% к следующей атаке!');
    }
    if (this.has(ctx, 'counter_strike')) {
      report.nextAttackBonusPercent += 0.05;
      report.messages.push('🥾 Сапоги контрудара: +5% к следующей атаке!');
    }
    return report;
  }

  analyzeIncoming(ctx: EffectContext, incomingDamage: number): IncomingEffectReport {
    const report: IncomingEffectReport = {
      reduction: 0,
      absorbFlat: 0,
      preventLethal: false,
      revive: false,
      messages: [],
    };
    const hp = this.hpPercent(ctx);

    if (this.has(ctx, 'damage_reduction')) report.reduction += 0.03;
    if (this.has(ctx, 'fortress')) report.reduction += 0.03;
    if (this.has(ctx, 'status_resistance')) report.reduction += 0.03;
    if (this.has(ctx, 'freeze_resistance')) report.reduction += 0.02;
    if (this.has(ctx, 'minion_protection') && ctx.hasMinion) report.reduction += 0.05;
    if ((this.has(ctx, 'soul_shield') || this.has(ctx, 'immortal_servant')) && ctx.hasMinion) {
      report.reduction += 0.05;
    }
    if (this.has(ctx, '-2% DEF')) report.reduction -= 0.02;
    if (this.has(ctx, 'titan_heart') && incomingDamage > ctx.playerMaxHp * 0.30) {
      report.reduction += 0.10;
      report.messages.push('🗿 Сердце каменного титана: -10% урона!');
    }
    if (this.has(ctx, 'emergency_shield') && hp < 25 && !ctx.usedOnce.includes('emergency_shield')) {
      ctx.usedOnce.push('emergency_shield');
      report.absorbFlat += Math.floor(ctx.playerMaxHp * 0.15);
      report.messages.push('🛡 Броня Короля: аварийный щит поглотил удар!');
    }
    if (this.has(ctx, 'last_hope') && hp < 15 && !ctx.usedOnce.includes('last_hope')) {
      ctx.usedOnce.push('last_hope');
      report.absorbFlat += Math.floor(ctx.playerMaxHp * 0.10);
      report.messages.push('👑 Корона последнего шанса: щит 10% HP!');
    }
    if (this.has(ctx, 'aegis_absorb') && incomingDamage > ctx.playerMaxHp * 0.25
      && !ctx.usedOnce.includes('aegis_absorb')) {
      ctx.usedOnce.push('aegis_absorb');
      report.absorbFlat += Math.floor(incomingDamage * 0.40);
      report.messages.push('🔱 Эгида обратного удара: поглощено 40% урона!');
    }
    if (ctx.usedOnce.includes('last_chance_shield')) {
      ctx.usedOnce.splice(ctx.usedOnce.indexOf('last_chance_shield'), 1);
      report.reduction += 0.20;
      report.messages.push('⏳ Часы последнего шанса: следующий урон -20%!');
    }
    if (this.has(ctx, 'last_chance') && !ctx.usedOnce.includes('last_chance')) {
      ctx.usedOnce.push('last_chance');
      report.preventLethal = true;
      ctx.usedOnce.push('last_chance_shield');
    }
    if (this.has(ctx, 'revive') && !ctx.usedOnce.includes('revive')) {
      ctx.usedOnce.push('revive');
      report.revive = true;
    }
    if (this.has(ctx, 'greed')) {
      report.reduction -= 0.10;
    }

    report.reduction = Math.max(-0.5, Math.min(report.reduction, MAX_TOTAL_REDUCTION));
    return report;
  }

  /**
   * Chance to fully negate a boss ability (shield/evasion/premonition items).
   */
  tryNullifyAbility(ctx: EffectContext): { nullified: boolean; message: string } {
    let chance = 0;
    let source = '';
    if (this.has(ctx, 'ability_block')) {
      chance = Math.max(chance, 0.15);
      source = '🛡 Щит Пустоты';
    }
    if (this.has(ctx, 'ability_evasion')) {
      chance = Math.max(chance, 0.12);
      source = '👟 Сапоги Пустоты';
    }
    if (this.has(ctx, 'warn_ability')) {
      chance = Math.max(chance, 0.10);
      source = '👁 Глаз Ведьмы';
    }
    if (chance > 0 && Math.random() < chance) {
      return { nullified: true, message: `${source}: способность босса подавлена!\n` };
    }
    return { nullified: false, message: '' };
  }

  analyzeRegen(ctx: EffectContext): { healPercent: number; messages: string[] } {
    const result = { healPercent: 0, messages: [] as string[] };
    if (this.has(ctx, 'regeneration')) {
      result.healPercent += 0.01;
    }
    if (this.has(ctx, 'absorption_eye')) {
      result.healPercent += 0.01;
    }
    if (this.has(ctx, 'recovery') || this.has(ctx, 'cooldown_evasion')) {
      result.healPercent += 0.005;
    }
    if (this.has(ctx, '-5% recovery')) {
      result.healPercent -= 0.005;
    }
    if (result.healPercent > 0) {
      result.messages.push('🌿 Регенерация: восстановление HP!');
    }
    return result;
  }
}

export const specialEffects = new SpecialEffectsService();
