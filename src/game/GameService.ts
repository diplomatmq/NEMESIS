import { UserModel } from '../database/models/User';
import { ChatModel } from '../database/models/Chat';
import { SeasonModel } from '../database/models/Season';
import { 
  PlayerProgressModel, 
  PlayerProgress, 
  ChatProgressModel, 
  CombatStateModel,
  CombatState 
} from '../database/models/PlayerProgress';
import {
  cooldownService,
  CooldownInfo,
  isCooldownExemptTelegramUser,
} from './CooldownService';
import { combatEngine, Enemy } from './CombatEngine';
import { behaviorTracker } from './BehaviorTracker';
import { lootService } from './LootService';
import { classService } from './ClassService';
import { achievementService } from './AchievementService';
import { potionService } from './PotionService';
import { ActionType, CombatResult } from '../types/game.types';
import { db } from '../database/db';
import { formatBossHealthBar, formatHealthBar, formatMobHealthBar } from './HealthBar';
import { InlineKeyboard } from 'grammy';
import { trailService } from './TrailService';

export interface GameContext {
  telegramUserId: number;
  telegramChatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  chatType?: string;
  chatTitle?: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  cooldownSet?: boolean;
  cooldownInfo?: CooldownInfo;
  needsPayment?: boolean;
  combatResult?: CombatResult;
  keyboard?: InlineKeyboard;
  privateMessage?: string;
}

export class GameService {
  
  async checkUserAccess(telegramUserId: number): Promise<{ hasAccess: boolean; message?: string }> {
    const hasStarted = await UserModel.hasStarted(telegramUserId);
    
    if (!hasStarted) {
      return {
        hasAccess: false,
        message: '🎮 **Чтобы начать играть:**\n\n' +
                 '1️⃣ Откройте личный чат с ботом\n' +
                 '2️⃣ Отправьте команду /start\n' +
                 '3️⃣ Вернитесь в группу и играйте!\n\n' +
                 '⚠️ Это нужно сделать только один раз.',
      };
    }

    return { hasAccess: true };
  }

  async executeAction(
    context: GameContext,
    action: string,
    bypassCooldown: boolean = false
  ): Promise<ActionResult> {
    
    // Check user access
    const accessCheck = await this.checkUserAccess(context.telegramUserId);
    if (!accessCheck.hasAccess) {
      return {
        success: false,
        message: accessCheck.message!,
      };
    }

    // Get or create user, chat, season
    const user = await UserModel.findByTelegramId(context.telegramUserId);
    const chat = await ChatModel.findOrCreate({
      telegram_chat_id: context.telegramChatId,
      chat_type: context.chatType,
      title: context.chatTitle,
    });
    const season = await SeasonModel.getOrCreateCurrentSeason();
    
    // Get GLOBAL player progress (not tied to chat)
    const progress = await PlayerProgressModel.findOrCreate(user!.id, season.id);
    const isCooldownExempt = isCooldownExemptTelegramUser(context.telegramUserId);
    
    // Get or create chat progress (for tracking floors per chat)
    const chatProgress = await ChatProgressModel.findOrCreate(user!.id, chat.id, season.id);

    // Check cooldown (unless bypassed by payment)
    if (!bypassCooldown && !isCooldownExempt) {
      const cooldownInfo = await cooldownService.check(user!.id, chat.id);
      
      if (cooldownInfo.isActive) {
        return {
          success: false,
          message: this.generateCooldownMessage(cooldownInfo),
          needsPayment: true,
          cooldownInfo,
        };
      }
    }

    // Execute the action
    const actionResult = await this.performAction(
      action, 
      progress, 
      chatProgress, 
      chat.id,
      season.id,
      user!.id,
      isCooldownExempt
    );
    if (progress.necro_debuff_games > 0) {
      await db.query(
        'UPDATE player_progress SET necro_debuff_games = GREATEST(necro_debuff_games - 1, 0) WHERE id = $1',
        [progress.id]
      );
    }
    if (progress.necro_bonus_games > 0) {
      await db.query(
        'UPDATE player_progress SET necro_bonus_games = GREATEST(necro_bonus_games - 1, 0) WHERE id = $1',
        [progress.id]
      );
    }

    // Set new cooldown (user-global, not per chat)
    if (!isCooldownExempt) {
      await cooldownService.set(user!.id, chat.id);
    }

    return {
      success: true,
      message: actionResult.message,
      cooldownSet: !isCooldownExempt,
      combatResult: actionResult.combatResult,
      keyboard: actionResult.keyboard,
      privateMessage: actionResult.privateMessage,
    };
  }

  private async performAction(
    action: string,
    progress: PlayerProgress,
    chatProgress: any,
    chatId: number,
    seasonId: number,
    userId: number,
    isCooldownExempt: boolean
  ): Promise<{
    message: string;
    combatResult?: CombatResult;
    keyboard?: InlineKeyboard;
    privateMessage?: string;
  }> {
    let rewardKeyboard: InlineKeyboard | undefined;

    const actionLower = action.toLowerCase().trim();

    if (await trailService.getEvent(userId, seasonId)) {
      return { message: '🧭 Сначала выберите вариант найденного следа на кнопках выше.' };
    }

    // Check if player wants to use a potion
    if (actionLower.includes('зель') || actionLower.includes('лечен') || actionLower === 'p') {
      const potionResult = await potionService.usePotion(progress.id, progress.hp, progress.max_hp);
      return { message: potionResult.message };
    }

    const isCombatAction =
      actionLower.includes('атак') ||
      actionLower.includes('удар') ||
      actionLower.includes('защит') ||
      actionLower.includes('блок') ||
      actionLower === 'a' ||
      actionLower === 'd';
    if (isCombatAction && !progress.class_id) {
      return {
        message: '🎭 Сначала выберите класс командой /class, затем начинайте бой.',
      };
    }

    // Parse action type
    let actionType: ActionType;
    
    if (actionLower.includes('атак') || actionLower.includes('удар') || actionLower === 'a') {
      actionType = ActionType.ATTACK;
    } else if (actionLower.includes('защит') || actionLower.includes('блок') || actionLower === 'd') {
      actionType = ActionType.DEFEND;
    } else {
      actionType = ActionType.ATTACK; // Default to attack
    }

    // Check if player has existing combat state
    let combatState = await CombatStateModel.find(userId, seasonId);
    let enemy: Enemy;
    let currentFloor = chatProgress.current_floor;

    if (combatState) {
      // Continue existing combat
      enemy = combatState.enemy_data;
      currentFloor = combatState.floor;
      
      // Check if player switched chat during combat
      if (currentFloor !== chatProgress.current_floor) {
        // Player is fighting from a different floor in another chat
        // They continue with the same enemy
      }
    } else {
      // Start new combat - generate enemy for current chat floor
      currentFloor = chatProgress.current_floor;
      const rareFloorVariant =
        currentFloor % 10 !== 0 && Math.random() < 0.1;
      enemy = combatEngine.generateEnemyS1(
        currentFloor,
        seasonId,
        progress.trail_modifier || 1,
        rareFloorVariant ||
        (progress.trail_modifier !== undefined && progress.trail_modifier !== 1)
      );
      const playerClassCode = progress.class_id
        ? (await classService.getClassById(progress.class_id))?.code
        : undefined;
      if (playerClassCode === 'necromancer' && Math.random() < 0.15) {
        enemy.summonedSupport = Math.random() < 0.7 ? 'mobs' : 'boss';
        enemy.summonedSupportName = enemy.summonedSupport === 'mobs'
          ? 'Три призванных мертвеца'
          : 'Призванный страж-босс';
      }
      if (progress.trail_modifier && progress.trail_modifier !== 1) {
        await db.query(
          'UPDATE player_progress SET trail_modifier = 1, updated_at = NOW() WHERE id = $1',
          [progress.id]
        );
      }
      
      // Save combat state
      combatState = await CombatStateModel.create({
        user_id: userId,
        season_id: seasonId,
        floor: currentFloor,
        enemy_data: enemy,
        player_hp_before: progress.hp
      });
    }

    // Get player class
    let playerClass = null;
    if (progress.class_id) {
      playerClass = await classService.getClassById(progress.class_id);
    }

    // Track behavior for the real database chat row. Passing the internal
    // user id here violates behavior_profiles.chat_id's foreign key.
    const behaviorProfile = await behaviorTracker.getOrCreateProfile(
      userId,
      chatId,
      seasonId
    );

    // Predict player action using AI (if floor > 10)
    let enemyAction: ActionType = ActionType.ATTACK;
    let tacticianAbilityUsed = false;
    let tacticianPrediction: ActionType | undefined;
    
    if (currentFloor > 10 && behaviorProfile.total_actions >= 3) {
      tacticianAbilityUsed = playerClass?.code === 'tactician';
      const predictedAction = behaviorTracker.predictNextAction(behaviorProfile);
      tacticianPrediction = predictedAction;
      const aiAccuracy = behaviorTracker.calculateAIAccuracy(
        currentFloor,
        progress.ai_resist || 0
      );
      
      // AI uses prediction with accuracy rate
      if (Math.random() < aiAccuracy) {
        // AI successfully predicted - counter it
        if (predictedAction === ActionType.ATTACK) {
          enemyAction = ActionType.DEFEND; // Defend against predicted attack
        } else {
          enemyAction = ActionType.ATTACK; // Attack if player predicted to defend
        }
      } else {
        // AI failed prediction - random action
        enemyAction = Math.random() > 0.6 ? ActionType.ATTACK : ActionType.DEFEND;
      }
    }

    // Execute combat
    const combatResult = await combatEngine.executeCombat(
      progress,
      enemy,
      actionType,
      enemyAction,
      playerClass?.code
    );
    if (tacticianAbilityUsed) {
      combatResult.message =
        '🧠 Тактик: вы просчитали поведение противника!\n' + combatResult.message;
    }

    // Record action for behavior tracking
    await behaviorTracker.recordAction(
      userId,
      chatId,
      seasonId,
      actionType,
      combatResult.enemyDamage
    );

    // Update player HP
    await PlayerProgressModel.updateHp(progress.id, combatResult.playerHp);

    // If enemy defeated, handle loot and floor progression
    if (combatResult.enemyDefeated) {
      const playerClass = progress.class_id ? await classService.getClassById(progress.class_id) : null;
      if (playerClass?.name === 'Некромант') {
        const chance = enemy.isBoss ? 0.6 : 0.8;
        const souls = Array.isArray(progress.necro_boss_souls) ? progress.necro_boss_souls : [];
        const canAbsorb = enemy.isBoss ? souls.length < 2 : progress.necro_mob_souls < 15;
        if (canAbsorb && Math.random() < chance) {
          if (enemy.isBoss) {
            const soul = { name: enemy.name, floor: currentFloor, boss_config: enemy.boss_config };
            await db.query(
              'UPDATE player_progress SET necro_boss_souls = necro_boss_souls || $2::jsonb WHERE id = $1',
              [progress.id, JSON.stringify([soul])]
            );
            combatResult.message += `\n☠️ **Некромант поглотил душу босса ${enemy.name}!** (${souls.length + 1}/2)`;
          } else {
            await db.query(
              'UPDATE player_progress SET necro_mob_souls = LEAST(necro_mob_souls + 1, 15) WHERE id = $1',
              [progress.id]
            );
            combatResult.message += `\n☠️ **Душа моба поглощена.** (${progress.necro_mob_souls + 1}/15)`;
          }
        }
      }
      // Calculate reward multiplier (50% reduction for non-primary chats)
      const rewardMultiplier = chatProgress.is_primary_chat ? 1.0 : 0.5;
      
      // Generate loot with reward multiplier
      const loot = await lootService.generateLootS1(
        currentFloor, 
        enemy.isBoss || false,
        progress.id,
        seasonId,
        rewardMultiplier
      );
      
      // Add gold
      await lootService.addGold(progress.id, loot.gold);
      
      // Add items to inventory
      for (const item of loot.items) {
        await lootService.addItemToInventory(progress.id, item.id);
      }
      
      combatResult.message += loot.message;

      // Advance floor in GLOBAL progress
      const newGlobalFloor = progress.floor + 1;
      await PlayerProgressModel.updateFloor(progress.id, newGlobalFloor);

      // Also advance floor in chat progress
      const newChatFloor = currentFloor + 1;
      await ChatProgressModel.updateFloor(chatProgress.id, newChatFloor);

      // Full HP restore on floor completion
      await potionService.healOnFloorCompletion(progress.id, progress.max_hp);
      combatResult.message += `\n💚 **HP полностью восстановлено!**\n`;

      // Check achievements
      const floorAchievements = await achievementService.checkAndUnlockAchievements(
        progress.id,
        { type: 'floor_reached', value: newGlobalFloor }
      );

      for (const ach of floorAchievements) {
        combatResult.message += `\n${achievementService.generateAchievementMessage(ach)}`;
      }

      // Boss kill achievement
      if (enemy.isBoss) {
        const bossAchievements = await achievementService.checkAndUnlockAchievements(
          progress.id,
          { type: 'boss_killed', value: 1 }
        );
        
        for (const ach of bossAchievements) {
          combatResult.message += `\n${achievementService.generateAchievementMessage(ach)}`;
        }
        if (playerClass?.code === 'necromancer' && Math.random() < 0.15) {
          const storedSouls = Array.isArray(progress.necro_boss_souls)
            ? [...progress.necro_boss_souls]
            : [];
          if (enemy.isBoss && storedSouls.length < 2) {
            storedSouls.push({ name: enemy.name, floor: currentFloor });
          }
          if (storedSouls.length > 0) {
            rewardKeyboard = new InlineKeyboard();
            storedSouls.slice(0, 2).forEach((soul, index) => {
              rewardKeyboard!.text(
                `☠️ Отдать ${soul.name}`,
                `throne:sacrifice:${index}`
              ).row();
            });
            rewardKeyboard.text('Не брать', 'throne:skip');
            combatResult.message += '\n👑 **Трон из мёртвых!** Выберите душу для дополнительной жертвы или откажитесь.';
          }
        }
      }

      // Update checkpoint every 10 floors
      if (newGlobalFloor % 10 === 0) {
        await PlayerProgressModel.updateCheckpoint(progress.id, newGlobalFloor);
      }

      // Clear combat state
      await CombatStateModel.delete(userId, seasonId);

      combatResult.message += `\n🏆 **Этаж ${currentFloor} пройден!**\n`;
      combatResult.message += `⬆️ Переход на этаж ${newChatFloor} (в этом чате).\n`;
      combatResult.message += `🌍 Глобальный прогресс: этаж ${newGlobalFloor}\n`;

      if (!enemy.isBoss && Math.random() < 0.1) {
        const trail = await trailService.createEvent(
          userId,
          seasonId,
          chatId,
          newChatFloor
        );
        combatResult.message += `\n${trail.message}`;
        return { message: combatResult.message, combatResult, keyboard: trail.keyboard };
      }
    } else {
      // Combat continues - update combat state with new enemy HP
      enemy.hp = combatResult.enemyHp;
      await CombatStateModel.update(combatState.id, {
        enemy_data: enemy,
        rounds_completed: (combatState.rounds_completed || 0) + 1
      });
    }

    // If player defeated, respawn at checkpoint
    if (combatResult.playerDefeated) {
      // Reset to checkpoint in global progress
      await PlayerProgressModel.updateFloor(progress.id, progress.checkpoint_floor);
      
      // Reset chat progress to checkpoint as well
      await ChatProgressModel.updateFloor(chatProgress.id, progress.checkpoint_floor);
      
      // Full HP restore on respawn
      await potionService.healOnFloorCompletion(progress.id, progress.max_hp);
      
      // Clear combat state
      await CombatStateModel.delete(userId, seasonId);
      
      combatResult.message += `\n💀 **Вы пали в бою...**\n`;
      combatResult.message += `⚰️ Возрождение на этаже ${progress.checkpoint_floor}.\n`;
      combatResult.message += `💚 HP восстановлено.\n`;
    }

    if (!isCooldownExempt) {
      combatResult.message += `\n⏳ Следующее действие доступно через 10 минут.`;
    }

    return {
      message: combatResult.message,
      combatResult,
      privateMessage: tacticianPrediction
        ? `🧠 Тактик, анализ завершён.\nСледующий ход бота может быть: ${
            tacticianPrediction === ActionType.ATTACK ? 'атака ⚔️' : 'защита 🛡️'
          }.\nЭто прогноз, а не гарантия.`
        : undefined,
      keyboard: rewardKeyboard,
    };
  }

  private generateCooldownMessage(cooldownInfo: CooldownInfo): string {
    const timeLeft = cooldownService.formatRemainingTime(cooldownInfo.remainingSeconds!);
    
    return `⚔️ Вы ещё не готовы к следующему действию.\n\n⏳ КД: ${timeLeft}\n\n⭐ Пропустить КД за 1 Telegram Star`;
  }

  async getPlayerStatus(
    telegramUserId: number,
    telegramChatId: number
  ): Promise<string> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) {
      return 'Пользователь не найден. Отправьте /start в личном чате с ботом.';
    }

    const chat = await ChatModel.findByTelegramChatId(telegramChatId);
    if (!chat) {
      return 'Чат не найден.';
    }

    const season = await SeasonModel.getCurrentSeason();
    if (!season) {
      return 'Сезон не найден.';
    }

    // Get GLOBAL progress
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) {
      return 'Прогресс не найден. Начните игру!';
    }

    // Get chat-specific progress
    const chatProgress = await ChatProgressModel.find(user.id, chat.id, season.id);

    // Check if in combat
    const combatState = await CombatStateModel.find(user.id, season.id);
    let combatInfo = '';
    if (combatState) {
      const enemy = combatState.enemy_data;
      const enemyHealthBar = enemy.isBoss
        ? formatBossHealthBar(enemy.hp, enemy.maxHp)
        : formatMobHealthBar(enemy.hp, enemy.maxHp);
      combatInfo = `\n⚔️ **В бою:** ${enemy.name}\n` +
                   `🩸 HP противника: ${enemyHealthBar}\n`;
    }

    // Get class info
    let className = 'Не выбран';
    if (progress.class_id) {
      const playerClass = await classService.getClassById(progress.class_id);
      if (playerClass) {
        className = `${playerClass.icon} ${playerClass.name}`;
      }
    }

    // Get cooldown info
    let cooldownText = '✅ Доступно';
    if (!isCooldownExemptTelegramUser(telegramUserId)) {
      const cooldown = await cooldownService.check(user.id, chat.id);
      if (cooldown.isActive) {
        cooldownText = `⏳ ${cooldownService.formatRemainingTime(cooldown.remainingSeconds!)}`;
      }
    }

    // Check if low health
    let healthWarning = '';
    if (potionService.isLowHealth(progress.hp, progress.max_hp)) {
      const potions = await potionService.getPlayerPotions(progress.id);
      if (potions.length > 0) {
        healthWarning = `\n⚠️ Низкое HP! У вас есть ${potions.length} зелий. Используйте: /potion`;
      } else {
        healthWarning = `\n⚠️ Низкое HP! Зелий нет. Будьте осторожны!`;
      }
    }

    let chatInfo = '';
    if (chatProgress) {
      const chatType = chatProgress.is_primary_chat ? '⭐ Основной' : '📎 Дополнительный (-50% наград)';
      chatInfo = `\n🏠 Чат: ${chatType}\n` +
                 `🏰 Этаж в чате: ${chatProgress.current_floor}\n` +
                 `🏆 Макс. этаж в чате: ${chatProgress.highest_floor_reached}`;
    }

    return `📊 **Статус игрока**\n\n` +
      `👤 ${user.first_name}\n` +
      `🎭 Класс: ${className}\n` +
      `🏆 Сезон: ${season.season_number}\n\n` +
      `🌍 **Глобальный прогресс:**\n` +
      `🏰 Этаж: ${progress.floor}\n` +
      `🚩 Checkpoint: ${progress.checkpoint_floor}\n` +
      `❤️ HP: ${formatHealthBar(progress.hp, progress.max_hp)}\n` +
      `⚔️ Атака: ${progress.attack}\n` +
      `🛡️ Защита: ${progress.defense}\n` +
      `⭐ Уровень: ${progress.level}\n` +
      `💰 Золото: ${progress.gold}\n` +
      chatInfo +
      combatInfo +
      healthWarning +
      `\n⏱️ Следующее действие: ${cooldownText}`;
  }

  async getInventory(
    telegramUserId: number,
    telegramChatId: number
  ): Promise<string> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) {
      return 'Пользователь не найден.';
    }

    const chat = await ChatModel.findByTelegramChatId(telegramChatId);
    if (!chat) {
      return 'Чат не найден.';
    }

    const season = await SeasonModel.getCurrentSeason();
    if (!season) {
      return 'Сезон не найден.';
    }

    // Get GLOBAL progress
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) {
      return 'Прогресс не найден.';
    }

    const inventory = await lootService.getInventory(progress.id);
    const equipment = await lootService.getEquipment(progress.id);
    const potions = await potionService.getPlayerPotions(progress.id);

    let msg = `🎒 **Инвентарь**\n\n`;
    msg += `💰 Золото: ${progress.gold}\n\n`;

    if (equipment) {
      msg += `⚔️ **Экипировка:**\n`;
      if (equipment.weapon_id) msg += `  • Оружие: экипировано\n`;
      if (equipment.armor_id) msg += `  • Броня: экипирована\n`;
      if (equipment.shield_id) msg += `  • Щит: экипирован\n`;
      msg += `\n`;
    }

    // Show potions first
    if (potions.length > 0) {
      msg += `🧪 **Зелья:** (всего: ${potions.length})\n`;
      const potionCounts = new Map<string, number>();
      for (const potion of potions) {
        potionCounts.set(potion.name, (potionCounts.get(potion.name) || 0) + 1);
      }
      for (const [name, count] of potionCounts) {
        msg += `  • ${name} x${count}\n`;
      }
      msg += `\n💡 Использовать: /potion\n\n`;
    } else {
      msg += `🧪 **Зелья:** нет\n\n`;
    }

    if (inventory.length > 0) {
      msg += `📦 **Предметы:**\n`;
      for (const item of inventory.slice(0, 10)) {
        const rarityEmoji = this.getRarityEmoji(item.rarity);
        msg += `${rarityEmoji} ${item.name} (${item.slot}) x${item.quantity}\n`;
      }
      
      if (inventory.length > 10) {
        msg += `\n...и ещё ${inventory.length - 10} предметов\n`;
      }
    } else {
      msg += `📦 Инвентарь пуст.\n`;
    }

    return msg;
  }

  async equipItem(telegramUserId: number, itemId: number): Promise<string> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) return 'Пользователь не найден.';
    const season = await SeasonModel.getCurrentSeason();
    if (!season) return 'Сезон не найден.';
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) return 'Прогресс не найден.';
    const equipped = await lootService.equipItem(progress.id, itemId);
    return equipped
      ? '✅ Предмет экипирован.'
      : '❌ Нельзя экипировать этот предмет: его нет в инвентаре, он несовместим с классом или ещё недоступен по уровню.';
  }

  async getEquipmentMenu(
    telegramUserId: number,
    slot: string = 'weapon',
    page = 0
  ): Promise<{ message: string; keyboard: InlineKeyboard }> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) throw new Error('Пользователь не найден.');
    const season = await SeasonModel.getCurrentSeason();
    if (!season) throw new Error('Сезон не найден.');
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) throw new Error('Прогресс не найден.');

    const validSlots = ['weapon', 'shield', 'helmet', 'armor', 'boots', 'accessory'];
    const selectedSlot = validSlots.includes(slot) ? slot : 'weapon';
    const result = await db.query(
      `SELECT i.id, i.name, i.rarity, i.attack_bonus, i.defense_bonus,
              i.hp_bonus, i.crit_chance_bonus, i.dodge_bonus,
              i.lifesteal_bonus, i.ai_resist_bonus, pi.quantity,
              pe.weapon_id, pe.shield_id, pe.helmet_id, pe.armor_id,
              pe.boots_id, pe.accessory_id
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       LEFT JOIN player_equipment pe ON pe.player_progress_id = pi.player_progress_id
       WHERE pi.player_progress_id = $1 AND i.slot = $2 AND pi.quantity > 0
       ORDER BY i.rarity DESC, i.name`,
      [progress.id, selectedSlot]
    );
    const pageSize = 5;
    const totalPages = Math.max(1, Math.ceil(result.rows.length / pageSize));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const currentColumn = `${selectedSlot}_id`;
    const currentId = result.rows[0]?.[currentColumn] ?? null;
    const rows = result.rows.slice(safePage * pageSize, (safePage + 1) * pageSize);
    const keyboard = new InlineKeyboard();
    const slotNames: Record<string, string> = {
      weapon: 'Оружие',
      shield: 'Щиты',
      helmet: 'Шлемы',
      armor: 'Броня',
      boots: 'Сапоги',
      accessory: 'Аксессуары',
    };
    keyboard
      .text('⚔️ Оружие', 'equipmenu:weapon:0')
      .text('🛡 Щиты', 'equipmenu:shield:0')
      .text('🪖 Шлемы', 'equipmenu:helmet:0')
      .row()
      .text('🥋 Броня', 'equipmenu:armor:0')
      .text('🥾 Сапоги', 'equipmenu:boots:0')
      .text('💍 Аксессуары', 'equipmenu:accessory:0')
      .row();
    for (const item of rows) {
      const equipped = Number(item[currentColumn]) === Number(item.id);
      const stats = `+${item.attack_bonus} ATK +${item.defense_bonus} DEF +${item.hp_bonus} HP`;
      keyboard.text(
        `${equipped ? '✅ ' : ''}${item.name} (${stats})`,
        `equipitem:${item.id}:${selectedSlot}:${safePage}`
      ).style(equipped ? 'success' : 'primary').row();
    }
    if (totalPages > 1) {
      keyboard
        .text('⬅️', `equipmenu:${selectedSlot}:${Math.max(0, safePage - 1)}`)
        .text(`${safePage + 1}/${totalPages}`, `equipmenu:${selectedSlot}:${safePage}`)
        .text('➡️', `equipmenu:${selectedSlot}:${Math.min(totalPages - 1, safePage + 1)}`)
        .row();
    }
    return {
      message:
        `🎒 **Экипировка — ${slotNames[selectedSlot]}**\n` +
        'Выберите предмет. Повторное нажатие снимает его, а выбор другого заменяет текущий.',
      keyboard,
    };
  }

  async toggleEquipment(
    telegramUserId: number,
    itemId: number,
    slot: string
  ): Promise<string> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) return 'Пользователь не найден.';
    const season = await SeasonModel.getCurrentSeason();
    if (!season) return 'Сезон не найден.';
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) return 'Прогресс не найден.';
    const item = await db.query(
      'SELECT id, slot FROM items WHERE id = $1 AND slot = $2',
      [itemId, slot]
    );
    if (!item.rows[0]) return 'Предмет не найден в этой категории.';
    const equipment = await lootService.getEquipment(progress.id);
    const column = `${slot}_id`;
    if (equipment && Number(equipment[column]) === itemId) {
      await db.query(`UPDATE player_equipment SET ${column} = NULL, updated_at = NOW() WHERE player_progress_id = $1`, [progress.id]);
      return '✅ Предмет снят.';
    }
    return (await lootService.equipItem(progress.id, itemId))
      ? '✅ Предмет надет.'
      : '❌ Этот предмет нельзя надеть.';
  }

  async getNecromancerMenu(telegramUserId: number): Promise<{ message: string; keyboard: InlineKeyboard }> {
    const progress = await this.getProgressForTelegramUser(telegramUserId);
    const playerClass = progress.class_id ? await classService.getClassById(progress.class_id) : null;
    if (playerClass?.name !== 'Некромант') {
      throw new Error('Команда доступна только Некроманту.');
    }
    const bosses = Array.isArray(progress.necro_boss_souls) ? progress.necro_boss_souls : [];
    const keyboard = new InlineKeyboard();
    if (progress.necro_mob_souls >= 3) {
      keyboard.text(`🩸 Принести 3 души мобов (${progress.necro_mob_souls})`, 'sacrifice:mobs').row();
      keyboard.text('⭐ Пропустить КД за 5 Stars', 'sacrifice:skip:mobs').row();
    }
    bosses.forEach((boss, index) => {
      keyboard.text(`☠️ ${boss.name} · ${boss.floor} этаж`, `sacrifice:boss:${index}`).row();
      keyboard.text('⭐ Пропустить КД за 5 Stars', `sacrifice:skip:boss:${index}`).row();
    });
    if (!keyboard.inline_keyboard.length) {
      keyboard.text('Закрыть', 'sacrifice:close');
    }
    return {
      message: `☠️ **Жертвоприношение**\nДуши мобов: ${progress.necro_mob_souls}/15\nДуши боссов: ${bosses.length}/2\n\nМожно принести 3 души мобов или одну душу босса.`,
      keyboard,
    };
  }

  async sacrifice(telegramUserId: number, target: 'mobs' | 'boss', bossIndex?: number, bypassCooldown = false): Promise<string> {
    const progress = await this.getProgressForTelegramUser(telegramUserId);
    const playerClass = progress.class_id ? await classService.getClassById(progress.class_id) : null;
    if (playerClass?.name !== 'Некромант') return '❌ Ритуал доступен только Некроманту.';
    const now = new Date();
    if (!bypassCooldown && progress.necro_sacrifice_available_at && progress.necro_sacrifice_available_at > now) {
      const minutes = Math.ceil((progress.necro_sacrifice_available_at.getTime() - now.getTime()) / 60000);
      return `⏳ Следующий ритуал будет доступен через ${minutes} мин.`;
    }
    const bosses = Array.isArray(progress.necro_boss_souls) ? progress.necro_boss_souls : [];
    if (target === 'mobs' && progress.necro_mob_souls < 3) return '❌ Нужно минимум 3 души обычных мобов.';
    if (target === 'boss' && (bossIndex === undefined || !bosses[bossIndex])) return '❌ Эта душа босса недоступна.';
    const good = Math.random() < 0.5;
    const scale = target === 'boss' ? Math.max(1, bosses[bossIndex!].floor / 10) : 1;
    const attack = Math.max(1, Math.round(3 * scale));
    const defense = Math.max(1, Math.round(2 * scale));
    await db.query(
      `UPDATE player_progress
       SET necro_mob_souls = CASE WHEN $2 = 'mobs' THEN necro_mob_souls - 3 ELSE necro_mob_souls END,
           necro_boss_souls = CASE WHEN $2 = 'boss' THEN (
             SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) FROM jsonb_array_elements(necro_boss_souls) WITH ORDINALITY t(value, ord)
             WHERE ord <> $3
           ) ELSE necro_boss_souls END,
           necro_sacrifice_available_at = NOW() + INTERVAL '2 hours',
           necro_debuff_games = CASE WHEN $4 THEN necro_debuff_games ELSE GREATEST(necro_debuff_games, 3) END,
           necro_attack_bonus = CASE WHEN $4 THEN $5 ELSE 0 END,
           necro_defense_bonus = CASE WHEN $4 THEN $6 ELSE 0 END,
           necro_bonus_games = CASE WHEN $4 THEN 3 ELSE 0 END
       WHERE id = $1`,
      [progress.id, target, (bossIndex ?? -1) + 1, good, attack, defense]
    );
    if (good) {
      return `✨ Ритуал удался! Поглощённая сила дала +${attack} атаки и +${defense} защиты.`;
    }
    return target === 'boss'
      ? '💀 Ритуал обернулся против вас: Некромант ослаблен на 3 следующие игры.'
      : '💀 Ритуал обернулся против вас: Некромант ослаблен на 3 следующие игры.';
  }

  private async getProgressForTelegramUser(telegramUserId: number): Promise<PlayerProgress> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) throw new Error('Пользователь не найден.');
    const season = await SeasonModel.getCurrentSeason();
    if (!season) throw new Error('Сезон не найден.');
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) throw new Error('Прогресс не найден.');
    return progress;
  }

  async resolveTrail(
    telegramUserId: number,
    telegramChatId: number,
    eventId: number,
    optionIndex: number
  ): Promise<ActionResult> {
    let rewardKeyboard: InlineKeyboard | undefined;
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) return { success: false, message: 'Пользователь не найден.' };
    const season = await SeasonModel.getCurrentSeason();
    if (!season) return { success: false, message: 'Сезон не найден.' };
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) return { success: false, message: 'Прогресс не найден.' };
    const chat = await ChatModel.findByTelegramChatId(telegramChatId);
    if (!chat) return { success: false, message: 'Чат не найден.' };

    const result = await trailService.resolveEvent(
      user.id,
      season.id,
      progress.id,
      chat.id,
      eventId,
      optionIndex
    );
    return { success: true, message: result.message, keyboard: result.keyboard };
  }

  async resolveTrailMarket(
    telegramUserId: number,
    telegramChatId: number,
    marketId: number,
    offerIndex: number
  ): Promise<ActionResult> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) return { success: false, message: 'Пользователь не найден.' };
    const season = await SeasonModel.getCurrentSeason();
    if (!season) return { success: false, message: 'Сезон не найден.' };
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) return { success: false, message: 'Прогресс не найден.' };
    const chat = await ChatModel.findByTelegramChatId(telegramChatId);
    if (!chat) return { success: false, message: 'Чат не найден.' };

    return {
      success: true,
      message: await trailService.resolveMarket(
        user.id,
        progress.id,
        chat.id,
        marketId,
        offerIndex
      ),
    };
  }

  async resolveTrailMarketAction(
    telegramUserId: number,
    telegramChatId: number,
    marketId: number,
    action: 'buy' | 'sell' | 'exchange'
  ): Promise<ActionResult> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) return { success: false, message: 'Пользователь не найден.' };
    const season = await SeasonModel.getCurrentSeason();
    if (!season) return { success: false, message: 'Сезон не найден.' };
    const progress = await PlayerProgressModel.find(user.id, season.id);
    const chat = await ChatModel.findByTelegramChatId(telegramChatId);
    if (!progress || !chat) return { success: false, message: 'Прогресс или чат не найден.' };
    const result = await trailService.resolveMarketAction(
      user.id,
      progress.id,
      chat.id,
      marketId,
      action
    );
    return { success: true, message: result.message, keyboard: result.keyboard };
  }

  private getRarityEmoji(rarity: string): string {
    switch (rarity) {
      case 'mythic': return '🌟';
      case 'legendary': return '⭐';
      case 'epic': return '💜';
      case 'rare': return '💙';
      case 'uncommon': return '💚';
      case 'common': return '⚪';
      default: return '📦';
    }
  }
}

export const gameService = new GameService();