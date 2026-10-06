import { UserModel } from '../database/models/User';
import { ChatModel } from '../database/models/Chat';
import { SeasonModel } from '../database/models/Season';
import { PlayerProgressModel, PlayerProgress } from '../database/models/PlayerProgress';
import { cooldownService, CooldownInfo } from './CooldownService';
import { combatEngine, Enemy } from './CombatEngine';
import { behaviorTracker } from './BehaviorTracker';
import { lootService } from './LootService';
import { classService } from './ClassService';
import { achievementService } from './AchievementService';
import { ActionType, CombatResult } from '../types/game.types';
import { db } from '../database/db';

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
}

export class GameService {
  
  async checkUserAccess(telegramUserId: number): Promise<{ hasAccess: boolean; message?: string }> {
    const hasStarted = await UserModel.hasStarted(telegramUserId);
    
    if (!hasStarted) {
      return {
        hasAccess: false,
        message: '🎮 Чтобы начать играть, сначала откройте личный чат с ботом и отправьте /start.',
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

    // Get or create user, chat, season, and player progress
    const user = await UserModel.findByTelegramId(context.telegramUserId);
    const chat = await ChatModel.findOrCreate({
      telegram_chat_id: context.telegramChatId,
      chat_type: context.chatType,
      title: context.chatTitle,
    });
    const season = await SeasonModel.getOrCreateCurrentSeason();
    const progress = await PlayerProgressModel.findOrCreate(user!.id, chat.id, season.id);

    // Check cooldown (unless bypassed by payment)
    if (!bypassCooldown) {
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
    const actionResult = await this.performAction(action, progress);

    // Set new cooldown
    await cooldownService.set(user!.id, chat.id);

    return {
      success: true,
      message: actionResult.message,
      cooldownSet: true,
      combatResult: actionResult.combatResult,
    };
  }

  private async performAction(
    action: string,
    progress: PlayerProgress
  ): Promise<{ message: string; combatResult?: CombatResult }> {
    
    const actionLower = action.toLowerCase().trim();

    // Parse action type
    let actionType: ActionType;
    
    if (actionLower.includes('атак') || actionLower.includes('удар') || actionLower === 'a') {
      actionType = ActionType.ATTACK;
    } else if (actionLower.includes('защит') || actionLower.includes('блок') || actionLower === 'd') {
      actionType = ActionType.DEFEND;
    } else {
      actionType = ActionType.ATTACK; // Default to attack
    }

    // Get player class
    let playerClass = null;
    if (progress.class_id) {
      playerClass = await classService.getClassById(progress.class_id);
    }

    // Get or create behavior profile
    const season = await SeasonModel.getCurrentSeason();
    const behaviorProfile = await behaviorTracker.getOrCreateProfile(
      progress.user_id,
      progress.chat_id,
      season!.id
    );

    // Generate enemy based on current floor
    const enemy = combatEngine.generateEnemy(progress.floor);

    // Predict player action using AI (if floor > 10)
    let enemyAction: ActionType = ActionType.ATTACK;
    
    if (progress.floor > 10 && behaviorProfile.total_actions >= 3) {
      const predictedAction = behaviorTracker.predictNextAction(behaviorProfile);
      const aiAccuracy = behaviorTracker.calculateAIAccuracy(progress.floor);
      
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

    // Record action for behavior tracking
    await behaviorTracker.recordAction(
      progress.user_id,
      progress.chat_id,
      season!.id,
      actionType,
      combatResult.enemyDamage
    );

    // Update player HP
    await PlayerProgressModel.updateHp(progress.id, combatResult.playerHp);

    // If enemy defeated, handle loot and floor progression
    if (combatResult.enemyDefeated) {
      const loot = await lootService.generateLoot(progress.floor, enemy.isBoss || false);
      
      // Add gold
      await lootService.addGold(progress.id, loot.gold);
      
      // Add items to inventory
      for (const item of loot.items) {
        await lootService.addItemToInventory(progress.id, item.id);
      }
      
      combatResult.message += loot.message;

      // Advance floor
      const newFloor = progress.floor + 1;
      await PlayerProgressModel.updateFloor(progress.id, newFloor);

      // Check achievements
      const floorAchievements = await achievementService.checkAndUnlockAchievements(
        progress.id,
        { type: 'floor_reached', value: newFloor }
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
      }

      // Update checkpoint every 10 floors
      if (newFloor % 10 === 0) {
        await PlayerProgressModel.updateCheckpoint(progress.id, newFloor);
      }

      combatResult.message += `\n🏆 Этаж ${progress.floor} пройден!\n`;
      combatResult.message += `⬆️ Переход на этаж ${newFloor}.\n`;
    }

    // If player defeated, respawn at checkpoint
    if (combatResult.playerDefeated) {
      await PlayerProgressModel.updateFloor(progress.id, progress.checkpoint_floor);
      await PlayerProgressModel.updateHp(progress.id, progress.max_hp);
      
      combatResult.message += `\n💀 Вы возродились на этаже ${progress.checkpoint_floor}.\n`;
    }

    combatResult.message += `\n⏳ Следующее действие доступно через 10 минут.`;

    return {
      message: combatResult.message,
      combatResult,
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

    const progress = await PlayerProgressModel.find(user.id, chat.id, season.id);
    if (!progress) {
      return 'Прогресс не найден. Начните игру!';
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
    const cooldown = await cooldownService.check(user.id, chat.id);
    let cooldownText = '✅ Доступно';
    if (cooldown.isActive) {
      cooldownText = `⏳ ${cooldownService.formatRemainingTime(cooldown.remainingSeconds!)}`;
    }

    return `📊 **Статус игрока**\n\n` +
      `👤 ${user.first_name}\n` +
      `🎭 Класс: ${className}\n` +
      `🏆 Сезон: ${season.season_number}\n\n` +
      `🏰 Этаж: ${progress.floor}\n` +
      `🚩 Checkpoint: ${progress.checkpoint_floor}\n` +
      `❤️ HP: ${progress.hp}/${progress.max_hp}\n` +
      `⚔️ Атака: ${progress.attack}\n` +
      `🛡️ Защита: ${progress.defense}\n` +
      `⭐ Уровень: ${progress.level}\n` +
      `💰 Золото: ${progress.gold}\n\n` +
      `⏱️ Следующее действие: ${cooldownText}`;
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

    const progress = await PlayerProgressModel.find(user.id, chat.id, season.id);
    if (!progress) {
      return 'Прогресс не найден.';
    }

    const inventory = await lootService.getInventory(progress.id);
    const equipment = await lootService.getEquipment(progress.id);

    let msg = `🎒 **Инвентарь**\n\n`;
    msg += `💰 Золото: ${progress.gold}\n\n`;

    if (equipment) {
      msg += `⚔️ **Экипировка:**\n`;
      if (equipment.weapon_id) msg += `  • Оружие: экипировано\n`;
      if (equipment.armor_id) msg += `  • Броня: экипирована\n`;
      if (equipment.shield_id) msg += `  • Щит: экипирован\n`;
      msg += `\n`;
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