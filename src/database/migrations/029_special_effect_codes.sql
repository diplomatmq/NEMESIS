-- Migration 029: stable special-effect codes and per-player effect cache.
--
-- Migration 015 replaced the machine-readable special_effect codes with
-- Russian display strings, while migration 022 inserted raw codes. The combat
-- engine needs a stable identifier, so normalise both forms into a dedicated
-- column that never gets translated.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS special_effect_code VARCHAR(50);

ALTER TABLE player_progress
  ADD COLUMN IF NOT EXISTS equipment_effects JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE items
SET special_effect_code = CASE special_effect
  WHEN 'Ярость' THEN 'rage'
  WHEN 'Крепость' THEN 'fortress'
  WHEN 'Уникальные криты' THEN 'unrepeated_crit'
  WHEN 'Древний вампиризм' THEN 'ancient_lifesteal'
  WHEN 'Усиление заклинаний' THEN 'spell_amplification'
  WHEN 'Мастерство последовательностей' THEN 'sequence_mastery'
  WHEN 'Хаос ИИ' THEN 'ai_chaos'
  WHEN 'Призыв' THEN 'summon'
  WHEN '-2% защита' THEN '-2% DEF'
  WHEN '+5% блок' THEN '+5% block'
  WHEN 'Игнор защиты' THEN 'ignore defense'
  WHEN 'Урон при низком HP' THEN 'low_hp_damage'
  WHEN 'Контратака' THEN 'counter_attack'
  WHEN 'Уклонение после защиты' THEN 'defend_dodge'
  WHEN 'Предупреждение о способности' THEN 'warn_ability'
  WHEN 'Урон элитам' THEN 'elite_damage'
  WHEN 'Казнь' THEN 'execute_damage'
  WHEN 'Атака после защиты' THEN 'after_defend_attack'
  WHEN 'Атака при низком HP' THEN 'low_hp_attack'
  WHEN 'Критический ожог' THEN 'critical_burn'
  WHEN 'Усиление при убийстве' THEN 'kill_next_attack'
  WHEN 'Урон при предсказании' THEN 'predicted_damage'
  WHEN 'Сила способностей' THEN 'ability_power'
  WHEN 'Блок' THEN 'block'
  WHEN 'Отражение урона' THEN 'reflect_damage'
  WHEN 'Идеальный блок' THEN 'perfect_block'
  WHEN 'Контр после защиты' THEN 'guard_counter'
  WHEN 'Блок способности' THEN 'ability_block'
  WHEN 'Снижение урона' THEN 'damage_reduction'
  WHEN 'Регенерация при атаке' THEN 'attack_regeneration'
  WHEN 'Сопротивление эффектам' THEN 'status_resistance'
  WHEN 'Аварийный щит' THEN 'emergency_shield'
  WHEN 'Длительность дебафов' THEN 'debuff_duration'
  WHEN 'Восстановление' THEN 'recovery'
  WHEN 'Сопротивление заморозке' THEN 'freeze_resistance'
  WHEN 'Уклонение от способностей' THEN 'ability_evasion'
  WHEN 'Уклонение от кулдауна' THEN 'cooldown_evasion'
  WHEN 'Регенерация' THEN 'regeneration'
  WHEN 'Воскрешение' THEN 'revive'
  WHEN 'Снижение первого удара' THEN 'first_hit_reduction'
  WHEN 'Скрытие последнего действия' THEN 'hide_last_action'
  WHEN 'Крит при низком HP' THEN 'low_hp_crit'
  WHEN 'Урон в атаку' THEN 'damage_to_attack'
  WHEN 'Жадность' THEN 'greed'
  WHEN 'Дополнительное действие' THEN 'extra_action'
  WHEN 'Атака от потери HP' THEN 'lost_hp_attack'
  WHEN 'Меняющийся бонус' THEN 'changing_bonus'
  WHEN 'Уникальный' THEN 'unique'
  WHEN '-5% восстановление' THEN '-5% recovery'
  ELSE special_effect
END
WHERE special_effect IS NOT NULL
  AND special_effect <> '';

-- Seed the effect cache for players who already have equipment equipped.
UPDATE player_progress pp
SET equipment_effects = COALESCE((
  SELECT jsonb_agg(DISTINCT i.special_effect_code)
  FROM player_equipment pe
  JOIN items i
    ON i.id IN (pe.weapon_id, pe.shield_id, pe.helmet_id, pe.armor_id, pe.boots_id, pe.accessory_id)
  WHERE pe.player_progress_id = pp.id
    AND i.special_effect_code IS NOT NULL
), '[]'::jsonb)
WHERE pp.equipment_effects = '[]'::jsonb;
