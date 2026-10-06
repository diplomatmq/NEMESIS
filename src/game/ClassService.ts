import { db } from '../database/db';
import { InlineKeyboard } from 'grammy';

export interface GameClass {
  id: number;
  name: string;
  code: string;
  icon: string;
  description: string;
  base_hp: number;
  base_attack: number;
  base_defense: number;
  passive_ability: string;
}

export class ClassService {
  async getAllClasses(): Promise<GameClass[]> {
    const result = await db.query(
      'SELECT * FROM classes ORDER BY id'
    );
    return result.rows;
  }

  async getClassById(classId: number): Promise<GameClass | null> {
    const result = await db.query(
      'SELECT * FROM classes WHERE id = $1',
      [classId]
    );
    return result.rows[0] || null;
  }

  async getClassByCode(code: string): Promise<GameClass | null> {
    const result = await db.query(
      'SELECT * FROM classes WHERE code = $1',
      [code]
    );
    return result.rows[0] || null;
  }

  async setPlayerClass(progressId: number, classId: number): Promise<void> {
    const gameClass = await this.getClassById(classId);
    if (!gameClass) {
      throw new Error('Class not found');
    }

    await db.query(
      `UPDATE player_progress 
       SET class_id = $1,
           max_hp = $2,
           hp = $2,
           attack = $3,
           defense = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [classId, gameClass.base_hp, gameClass.base_attack, gameClass.base_defense, progressId]
    );
  }

  generateClassSelectionKeyboard(): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    
    // Row 1
    keyboard
      .text('⚔️ Берсерк', 'class:berserker')
      .text('🛡 Страж', 'class:guardian')
      .row();
    
    // Row 2
    keyboard
      .text('🗡 Ассасин', 'class:assassin')
      .text('🩸 Вампир', 'class:vampire')
      .row();
    
    // Row 3
    keyboard
      .text('🧙 Арканист', 'class:arcanist')
      .text('🧠 Тактик', 'class:tactician')
      .row();
    
    // Row 4
    keyboard
      .text('🃏 Шут', 'class:jester')
      .text('☠️ Некромант', 'class:necromancer');
    
    return keyboard;
  }

  generateClassDescription(): string {
    return `🎭 Выберите класс для этого сезона:\n\n` +
      `⚔️ **Берсерк** - Мастер ближнего боя\n` +
      `   💪 HP: 120 | ATK: 15 | DEF: 3\n` +
      `   🔥 Урон растёт при низком HP\n\n` +
      
      `🛡 **Страж** - Непробиваемая защита\n` +
      `   💪 HP: 150 | ATK: 8 | DEF: 12\n` +
      `   🛡 Поглощает часть урона\n\n` +
      
      `🗡 **Ассасин** - Мастер критов\n` +
      `   💪 HP: 90 | ATK: 12 | DEF: 5\n` +
      `   💥 Высокий шанс крита\n\n` +
      
      `🩸 **Вампир** - Восстановление HP\n` +
      `   💪 HP: 110 | ATK: 10 | DEF: 6\n` +
      `   💉 Lifesteal от атак\n\n` +
      
      `🧙 **Арканист** - Магический урон\n` +
      `   💪 HP: 80 | ATK: 14 | DEF: 4\n` +
      `   ✨ Игнорирует часть защиты\n\n` +
      
      `🧠 **Тактик** - Антиадаптация\n` +
      `   💪 HP: 100 | ATK: 10 | DEF: 8\n` +
      `   🧠 Сопротивление AI\n\n` +
      
      `🃏 **Шут** - Непредсказуемость\n` +
      `   💪 HP: 95 | ATK: 11 | DEF: 7\n` +
      `   🎲 Случайные эффекты\n\n` +
      
      `☠️ **Некромант** - Призыв мёртвых\n` +
      `   💪 HP: 85 | ATK: 9 | DEF: 6\n` +
      `   👻 Призывает миньонов`;
  }

  applyClassPassive(
    classCode: string,
    baseDamage: number,
    playerHp: number,
    playerMaxHp: number
  ): number {
    let damage = baseDamage;

    switch (classCode) {
      case 'berserker':
        // Увеличение урона при низком HP
        const hpPercent = (playerHp / playerMaxHp) * 100;
        if (hpPercent < 30) {
          damage = Math.floor(damage * 1.5);
        } else if (hpPercent < 50) {
          damage = Math.floor(damage * 1.25);
        }
        break;

      case 'assassin':
        // Увеличенный шанс крита (обрабатывается в CombatEngine)
        break;

      case 'vampire':
        // Lifesteal (обрабатывается в CombatEngine)
        break;

      case 'arcanist':
        // Магический урон - игнорирует больше защиты (обрабатывается в CombatEngine)
        damage = Math.floor(damage * 1.1);
        break;

      case 'tactician':
        // AI resist (влияет на BehaviorTracker)
        break;

      case 'jester':
        // Случайные эффекты
        const randomBonus = Math.random();
        if (randomBonus > 0.7) {
          damage = Math.floor(damage * 1.5); // 30% шанс на +50%
        } else if (randomBonus < 0.1) {
          damage = Math.floor(damage * 0.5); // 10% шанс на -50%
        }
        break;

      case 'necromancer':
        // Миньоны добавляют урон
        damage = Math.floor(damage * 1.15);
        break;

      case 'guardian':
        // Защитник (пассивка обрабатывается при получении урона)
        break;
    }

    return damage;
  }

  calculateClassDefenseBonus(classCode: string, baseDamage: number): number {
    let finalDamage = baseDamage;

    if (classCode === 'guardian') {
      // Страж поглощает 20% урона
      finalDamage = Math.floor(baseDamage * 0.8);
    }

    return finalDamage;
  }

  getClassCritBonus(classCode: string): number {
    if (classCode === 'assassin') {
      return 0.25; // +15% к базовому 10% = 25% крит
    }
    return 0.1; // Базовый 10%
  }

  getClassLifesteal(classCode: string): number {
    if (classCode === 'vampire') {
      return 0.3; // 30% lifesteal
    }
    return 0;
  }
}

export const classService = new ClassService();
