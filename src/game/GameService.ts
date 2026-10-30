import { UserModel } from '../database/models/User';
import { config } from '../config';
import { ChatModel } from '../database/models/Chat';
import { SeasonModel } from '../database/models/Season';
import { 
  PlayerProgressModel, 
  PlayerProgress,
  BossPin,
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
import { bossSystem, PREDICTION_ACTION_BIAS, formatBossIcon, stripCustomEmoji, soulDisplayName } from './BossSystem';
import { behaviorTracker } from './BehaviorTracker';
import { lootService } from './LootService';
import { classService } from './ClassService';
import { achievementService } from './AchievementService';
import { potionService } from './PotionService';
import { ActionType, CombatResult } from '../types/game.types';
import { db } from '../database/db';
import { formatBossHealthBar, formatHealthBar, formatMobHealthBar } from './HealthBar';
import { CUSTOM_EMOJI, ce } from './CustomEmoji';
import { InlineKeyboard } from 'grammy';
import { trailService } from './TrailService';
import { dailyMarketService } from './DailyMarketService';
import { merchantService } from './MerchantService';

/** Every death at the hands of the same boss shaves 5% off its stats. */
const BOSS_FAIL_WEAKENING_STEP = 0.05;

/** Weakening stacks stop helping once 80% of the boss's stats are gone. */
const BOSS_FAIL_WEAKENING_CAP = 0.80;

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
  adminNotification?: string;
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
      context.telegramUserId,
      isCooldownExempt
    );

    // Set new cooldown (user-global, not per chat).
    // Actions that don't consume a turn (a failed potion attempt, a hint about
    // an unfinished trail) must not start a cooldown either.
    const consumesCooldown = actionResult.consumesCooldown !== false;
    if (!isCooldownExempt && consumesCooldown) {
      await cooldownService.set(user!.id, chat.id);
    }

    // A caught NFT is handed out by the admins manually, so they are notified
    // with the player's details.
    let adminNotification: string | undefined;
    if (actionResult.nftDrop) {
      const playerName = context.username ? `@${context.username}` : (context.firstName ?? 'Игрок');
      adminNotification =
        `${ce(CUSTOM_EMOJI.nft, '🎖')} <b>Выпал NFT!</b>\n` +
        `Игрок: ${playerName} (id: ${context.telegramUserId})\n` +
        `Босс: ${actionResult.nftDrop.bossName}\n` +
        `Этаж: ${actionResult.nftDrop.floor}`;
    }

    return {
      success: true,
      message: actionResult.message,
      cooldownSet: !isCooldownExempt && consumesCooldown,
      combatResult: actionResult.combatResult,
      keyboard: actionResult.keyboard,
      privateMessage: actionResult.privateMessage,
      adminNotification,
    };
  }

  private async performAction(
    action: string,
    progress: PlayerProgress,
    chatProgress: any,
    chatId: number,
    seasonId: number,
    userId: number,
    telegramUserId: number,
    isCooldownExempt: boolean
  ): Promise<{
    message: string;
    combatResult?: CombatResult;
    keyboard?: InlineKeyboard;
    privateMessage?: string;
    consumesCooldown?: boolean;
    nftDrop?: { bossName: string; floor: number };
  }> {
    let rewardKeyboard: InlineKeyboard | undefined;

    const actionLower = action.toLowerCase().trim();

    if (await trailService.getEvent(userId, seasonId, chatId)) {
      return { message: '🧭 Сначала выберите вариант найденного следа на кнопках выше.', consumesCooldown: false };
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
        message: `${ce(CUSTOM_EMOJI.class, '🎭')} Сначала выберите класс командой /class, затем начинайте бой.`,
        consumesCooldown: false,
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

    // Decrement necromancer effect counters only for real combat actions
    // (based on the parsed action type, not the raw command string)
    if (actionType === ActionType.ATTACK || actionType === ActionType.DEFEND) {
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
    }

    // Check if player has existing combat state FOR THIS CHAT
    let combatState = await CombatStateModel.find(userId, seasonId, chatId);
    let enemy: Enemy;
    let currentFloor = chatProgress.current_floor;
    let nftDrop: { bossName: string; floor: number } | undefined;
    let bossWeakenPercent = 0;

    if (combatState) {
      // Continue existing combat IN THIS CHAT
      enemy = combatState.enemy_data;
      currentFloor = combatState.floor;

      // Fights saved before boss emoji metadata existed carry no boss_config,
      // so they would render a plain name. Rehydrate it from the catalogue.
      if (enemy.isBoss && !enemy.boss_config) {
        const bossConfig = bossSystem.getBossConfig(currentFloor, seasonId);
        enemy.boss_config = bossConfig;
        enemy.name = `${formatBossIcon(bossConfig)} ${bossConfig.name}`;
        await CombatStateModel.update(combatState.id, { enemy_data: enemy });
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

      // A boss that already killed the player comes back weakened: each death
      // adds another 5% until the boss is finally defeated. Any other boss is
      // fought at full strength.
      if (enemy.isBoss && progress.boss_fail_stacks > 0 && progress.boss_fail_floor === currentFloor) {
        const penalty = Math.min(progress.boss_fail_stacks * BOSS_FAIL_WEAKENING_STEP, BOSS_FAIL_WEAKENING_CAP);
        const factor = 1 - penalty;
        enemy.hp = Math.max(1, Math.floor(enemy.hp * factor));
        enemy.maxHp = enemy.hp;
        enemy.attack = Math.max(1, Math.floor(enemy.attack * factor));
        enemy.defense = Math.max(1, Math.floor(enemy.defense * factor));
        if (enemy.boss_config) {
          enemy.boss_config.base_hp = enemy.maxHp;
          enemy.boss_config.base_attack = enemy.attack;
          enemy.boss_config.base_defense = enemy.defense;
        }
        bossWeakenPercent = Math.round(penalty * 100);
      }

      const playerClassCode = progress.class_id
        ? (await classService.getClassById(progress.class_id))?.code
        : undefined;
      // Necromancer ability: summon minions if they have souls
      if (playerClassCode === 'necromancer' && Math.random() < 0.85) {
        const hasBossSouls = Array.isArray(progress.necro_boss_souls) && progress.necro_boss_souls.length > 0;
        const hasMobSouls = progress.necro_mob_souls > 0;
        
        if (hasBossSouls || hasMobSouls) {
          // If has boss souls, 70% chance to summon boss, otherwise summon mobs
          const summonBoss = hasBossSouls && Math.random() < 0.7;
          
          if (summonBoss && hasBossSouls) {
            enemy.summonedSupport = 'boss';
            const bossSoul = progress.necro_boss_souls[0];
            enemy.summonedSupportName = bossSoul.name;
          } else if (hasMobSouls && progress.necro_mob_souls >= 3) {
            enemy.summonedSupport = 'mobs';
            enemy.summonedSupportName = 'Три призванных мертвеца';
          }
        }
      }
      if (progress.trail_modifier && progress.trail_modifier !== 1) {
        await db.query(
          'UPDATE player_progress SET trail_modifier = 1, updated_at = NOW() WHERE id = $1',
          [progress.id]
        );
      }
      
      // Save combat state FOR THIS CHAT
      combatState = await CombatStateModel.create({
        user_id: userId,
        season_id: seasonId,
        chat_id: chatId,
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
    let predictedEnemyAction: ActionType | undefined;
    
    // AI всегда предсказывает действия игрока для всех классов
    if (currentFloor > 10 && behaviorProfile.total_actions >= 3) {
      tacticianAbilityUsed = playerClass?.code === 'tactician';

      // 1. Прогноз — это отдельная догадка о действии врага, а не само действие.
      const predictedPlayerAction = behaviorTracker.predictNextAction(behaviorProfile);
      const aiAccuracy = behaviorTracker.calculateAIAccuracy(
        currentFloor,
        progress.ai_resist || 0
      );
      if (Math.random() < aiAccuracy) {
        // AI успешно предсказал игрока — предполагает контр-действие.
        predictedEnemyAction =
          predictedPlayerAction === ActionType.ATTACK
            ? ActionType.DEFEND
            : ActionType.ATTACK;
      } else {
        // AI ошибся — прогноз случаен.
        predictedEnemyAction = Math.random() > 0.6 ? ActionType.ATTACK : ActionType.DEFEND;
      }

      // 2. Фактическое действие выбирается независимо, но с повышенным весом
      // для совпадающего с прогнозом варианта — совпадение не гарантировано.
      enemyAction = this.rollEnemyAction(predictedEnemyAction);
    } else {
      // Для низких этажей - простая случайная логика
      enemyAction = Math.random() > 0.5 ? ActionType.ATTACK : ActionType.DEFEND;
    }

    // Execute combat
    const combatResult = await combatEngine.executeCombat(
      progress,
      enemy,
      actionType,
      enemyAction,
      playerClass?.code,
      predictedEnemyAction
    );

    // Тактик видит предположение о действии врага
    if (tacticianAbilityUsed && predictedEnemyAction) {
      const actionText = predictedEnemyAction === ActionType.ATTACK ? 'атакует' : 'защищается';
      combatResult.message =
        `🧠 Тактик предполагает: враг, вероятнее всего, ${actionText}.\n` + combatResult.message;
    }

    if (bossWeakenPercent > 0) {
      combatResult.message =
        `📉 Босс ослаблен на ${bossWeakenPercent}% (поражений подряд: ${progress.boss_fail_stacks}).\n` +
        combatResult.message;
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
      
      // Necromancer soul absorption
      if (playerClass?.name === 'Некромант' && enemy.isBoss) {
        const dropChance = 0.6; // 60% шанс дропа души босса
        const souls = Array.isArray(progress.necro_boss_souls) ? progress.necro_boss_souls : [];
        const soulDropped = Math.random() < dropChance;
        
        if (soulDropped) {
          const soul = { name: soulDisplayName(enemy), floor: currentFloor, boss_config: enemy.boss_config };
          
          // If both boss soul slots are full, force sacrifice choice
          if (souls.length >= 2) {
            rewardKeyboard = new InlineKeyboard();
            souls.forEach((existingSoul, index) => {
              const soulEmojiId = existingSoul.boss_config?.custom_emoji_id;
              rewardKeyboard!.text(
                `${soulEmojiId ? '' : '☠️ '}Заменить ${soulDisplayName(existingSoul)}`,
                `sacrifice:replace:${index}`
              ).icon(soulEmojiId).row();
            });
            rewardKeyboard.text('❌ Отказаться', 'sacrifice:decline');
            
            // Store the new soul temporarily for the callback
            await db.query(
              'UPDATE player_progress SET necro_pending_soul = $2 WHERE id = $1',
              [progress.id, JSON.stringify(soul)]
            );
            
            combatResult.message += `\n\n☠️ **Душа босса ${enemy.name} готова к поглощению!**\n` +
              `Но оба слота заняты. Выберите какую душу заменить или откажитесь:`;
          } else {
            // Add boss soul directly - проверяем что его еще нет
            const hasDuplicate = souls.some(s => s.name === soul.name && s.floor === soul.floor);
            if (!hasDuplicate) {
              await db.query(
                'UPDATE player_progress SET necro_boss_souls = necro_boss_souls || $2::jsonb WHERE id = $1',
                [progress.id, JSON.stringify([soul])]
              );
              combatResult.message += `\n☠️ **Некромант поглотил душу босса ${enemy.name}!** (${souls.length + 1}/2)`;
            }
          }
        }
      } else if (playerClass?.name === 'Некромант' && !enemy.isBoss) {
        // Mob soul absorption
        const dropChance = 0.8; // 80% шанс дропа души моба
        if (Math.random() < dropChance && progress.necro_mob_souls < 15) {
          await db.query(
            'UPDATE player_progress SET necro_mob_souls = LEAST(necro_mob_souls + 1, 15) WHERE id = $1',
            [progress.id]
          );
          combatResult.message += `\n☠️ **Душа моба поглощена.** (${progress.necro_mob_souls + 1}/15)`;
        }
      }
      // Full rewards only while pushing the persistent maximum forward.
      // progress.floor (and the checkpoint) can drop on death, so the reward
      // must be derived from the never-decreasing highest_floor_reached.
      const isExploringNewFloor = currentFloor >= progress.highest_floor_reached;
      const rewardMultiplier = isExploringNewFloor ? 1.0 : 0.5;
      
      if (!isExploringNewFloor) {
        combatResult.message += `\n⚠️ Этаж уже пройден ранее: дроп -50%\n`;
      }
      
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

      // A caught NFT is a real-world reward granted by hand. The counter is
      // stored here; the admin notification itself is assembled by the caller,
      // which has the player's Telegram details.
      if (loot.nftCaught) {
        nftDrop = { bossName: enemy.name, floor: currentFloor };
      }

      // Advance floor in chat progress first
      const previousMaxFloor = progress.highest_floor_reached;
      const newChatFloor = currentFloor + 1;
      await ChatProgressModel.updateFloor(chatProgress.id, newChatFloor);

      // Count the cleared floor towards the season-long class winrate.
      await db.query(
        'UPDATE player_progress SET total_wins = total_wins + 1, updated_at = NOW() WHERE id = $1',
        [progress.id]
      );

      // The global floor is a record, not the position of the last chat. It is
      // only written when this chat beats the all-time maximum, so playing an
      // under-levelled chat can never roll the global floor back.
      const isNewRecord = newChatFloor > previousMaxFloor;
      if (isNewRecord) {
        await PlayerProgressModel.updateFloor(progress.id, newChatFloor);
      }
      const newGlobalFloor = isNewRecord ? newChatFloor : previousMaxFloor;

      // Full HP restore on floor completion
      await potionService.healOnFloorCompletion(progress.id, progress.max_hp);
      combatResult.message += `\n💚 **HP полностью восстановлено!**\n`;

      // Check achievements (use global floor for achievements)
      const floorAchievements = await achievementService.checkAndUnlockAchievements(
        progress.id,
        { type: 'floor_reached', value: newGlobalFloor }
      );

      for (const ach of floorAchievements) {
        combatResult.message += `\n${achievementService.generateAchievementMessage(ach)}`;
      }

      // Boss kill achievement
      if (enemy.isBoss) {
        // The boss is finally down: forget every accumulated weakening so the
        // next boss starts at full strength.
        if (progress.boss_fail_floor !== null || (progress.boss_fail_stacks || 0) > 0) {
          await db.query(
            'UPDATE player_progress SET boss_fail_floor = NULL, boss_fail_stacks = 0, updated_at = NOW() WHERE id = $1',
            [progress.id]
          );
        }

        // Every named boss permanently drops its custom emoji as a pin the
        // first time it is defeated. Repeated kills never duplicate it.
        const pinEmojiId = enemy.boss_config?.custom_emoji_id;
        if (pinEmojiId) {
          const pins = Array.isArray(progress.boss_pins) ? progress.boss_pins : [];
          const alreadyOwned = pins.some((pin) => pin.boss_config?.custom_emoji_id === pinEmojiId);
          if (!alreadyOwned) {
            const pin: BossPin = {
              name: enemy.boss_config?.name ?? stripCustomEmoji(enemy.name),
              floor: currentFloor,
              boss_config: {
                icon: enemy.boss_config?.icon,
                custom_emoji_id: pinEmojiId,
              },
            };
            await db.query(
              `UPDATE player_progress
               SET boss_pins = boss_pins || $2::jsonb, updated_at = NOW()
               WHERE id = $1`,
              [progress.id, JSON.stringify([pin])]
            );
            combatResult.message += `\n📌 **Получен пин босса:** ${formatBossIcon(pin.boss_config ?? {})} ${pin.name}`;
          }
        }

        const bossAchievements = await achievementService.checkAndUnlockAchievements(
          progress.id,
          { type: 'boss_killed', value: 1 }
        );
        
        for (const ach of bossAchievements) {
          combatResult.message += `\n${achievementService.generateAchievementMessage(ach)}`;
        }
        // Necromancer: Throne of the Dead event
        if (playerClass?.code === 'necromancer') {
          const storedSouls = Array.isArray(progress.necro_boss_souls)
            ? [...progress.necro_boss_souls]
            : [];
          if (enemy.isBoss && storedSouls.length < 2) {
            storedSouls.push({ name: soulDisplayName(enemy), floor: currentFloor, boss_config: enemy.boss_config });
          }
          if (storedSouls.length > 0 && Math.random() < 0.15) {
            rewardKeyboard = new InlineKeyboard();
            storedSouls.slice(0, 2).forEach((soul, index) => {
              const soulEmojiId = soul.boss_config?.custom_emoji_id;
              rewardKeyboard!.text(
                `${soulEmojiId ? '' : '☠️ '}Отдать ${soulDisplayName(soul)}`,
                `throne:sacrifice:${index}`
              ).icon(soulEmojiId).row();
            });
            rewardKeyboard.text('Не брать', 'throne:skip');
            combatResult.message += '\n👑 **Трон из мёртвых!** Выберите душу для дополнительной жертвы или откажитесь.';
          }
        }
      }

      // Update checkpoint every 10 floors (use global floor)
      if (newGlobalFloor % 10 === 0 && newGlobalFloor > progress.checkpoint_floor) {
        await PlayerProgressModel.updateCheckpoint(progress.id, newGlobalFloor);
      }

      // Clear combat state FOR THIS CHAT
      await CombatStateModel.delete(userId, seasonId, chatId);

      combatResult.message += `\n${ce(CUSTOM_EMOJI.floor, '🏰')} **Этаж ${currentFloor} пройден!**\n`;
      combatResult.message += `⬆️ Переход на этаж ${newChatFloor} (в этом чате).\n`;
      if (isNewRecord) {
        combatResult.message += `${ce(CUSTOM_EMOJI.planet, '🌍')} Новый глобальный рекорд: этаж ${newChatFloor}!\n`;
      } else {
        combatResult.message += `${ce(CUSTOM_EMOJI.planet, '🌍')} Глобальный максимум: этаж ${previousMaxFloor}\n`;
      }

      if (!enemy.isBoss && Math.random() < 0.1) {
        const trail = await trailService.createEvent(
          userId,
          seasonId,
          chatId,
          newChatFloor,
          telegramUserId
        );
        combatResult.message += `\n${trail.message}`;
        return { message: combatResult.message, combatResult, keyboard: trail.keyboard, nftDrop };
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
      // Count the loss towards the season-long class winrate.
      await db.query(
        'UPDATE player_progress SET total_deaths = total_deaths + 1, updated_at = NOW() WHERE id = $1',
        [progress.id]
      );

      // Remember which boss beat the player. Each consecutive death to the same
      // boss weakens it on the next attempt; killing it clears the counter.
      if (enemy.isBoss) {
        const stacks = progress.boss_fail_floor === currentFloor ? (progress.boss_fail_stacks || 0) + 1 : 1;
        await db.query(
          'UPDATE player_progress SET boss_fail_floor = $2, boss_fail_stacks = $3, updated_at = NOW() WHERE id = $1',
          [progress.id, currentFloor, stacks]
        );
        const nextPenalty = Math.min(stacks * BOSS_FAIL_WEAKENING_STEP, BOSS_FAIL_WEAKENING_CAP);
        combatResult.message += `\n📉 В следующий раз босс будет ослаблен на ${Math.round(nextPenalty * 100)}%.\n`;
      }

      // Reset this chat to the checkpoint. The global floor is a record and
      // must not move backwards.
      await ChatProgressModel.updateFloor(chatProgress.id, progress.checkpoint_floor);
      
      // Full HP restore on respawn
      await potionService.healOnFloorCompletion(progress.id, progress.max_hp);
      
      // Clear combat state FOR THIS CHAT
      await CombatStateModel.delete(userId, seasonId, chatId);
      
      combatResult.message += `\n💀 **Вы пали в бою...**\n`;
      combatResult.message += `${ce(CUSTOM_EMOJI.checkpoint, '🚩')} Возрождение на этаже ${progress.checkpoint_floor}.\n`;
      combatResult.message += `💚 HP восстановлено.\n`;
    }

    if (!isCooldownExempt) {
      combatResult.message += `\n⏳ Следующее действие доступно через ${config.game.cooldownMinutes} минут.`;
    }

    return {
      message: combatResult.message,
      combatResult,
      keyboard: rewardKeyboard,
      nftDrop,
    };
  }

  private generateCooldownMessage(cooldownInfo: CooldownInfo): string {
    const timeLeft = cooldownService.formatRemainingTime(cooldownInfo.remainingSeconds!);
    
    return `${ce(CUSTOM_EMOJI.attack, '⚔️')} Вы ещё не готовы к следующему действию.\n\n⏳ КД: ${timeLeft}\n\n⭐ Пропустить КД за 1 Telegram Star`;
  }

  async getPlayerStatus(
    telegramUserId: number,
    telegramChatId: number,
    isPrivateChat: boolean = false
  ): Promise<{ message: string; keyboard: InlineKeyboard }> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) {
      return { 
        message: 'Пользователь не найден. Отправьте /start в личном чате с ботом.',
        keyboard: new InlineKeyboard()
      };
    }

    const chat = await ChatModel.findByTelegramChatId(telegramChatId);
    if (!chat) {
      return { 
        message: 'Чат не найден.',
        keyboard: new InlineKeyboard()
      };
    }

    const season = await SeasonModel.getCurrentSeason();
    if (!season) {
      return { 
        message: 'Сезон не найден.',
        keyboard: new InlineKeyboard()
      };
    }

    // Get GLOBAL progress
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) {
      return { 
        message: 'Прогресс не найден. Начните игру!',
        keyboard: new InlineKeyboard()
      };
    }

    // Get chat-specific progress
    const chatProgress = await ChatProgressModel.find(user.id, chat.id, season.id);

    // Check if in combat
    const combatState = await CombatStateModel.find(user.id, season.id, chat.id);
    let combatInfo = '';
    if (combatState) {
      const enemy = combatState.enemy_data;
      const enemyHealthBar = enemy.isBoss
        ? formatBossHealthBar(enemy.hp, enemy.maxHp)
        : formatMobHealthBar(enemy.hp, enemy.maxHp);
      combatInfo = `\n${ce(CUSTOM_EMOJI.attack, '⚔️')} **В бою:** ${enemy.name}\n` +
                   `🩸 HP противника: ${enemyHealthBar}\n`;
    }

    // Get class info
    let className = 'Не выбран';
    let necromancerInfo = '';
    if (progress.class_id) {
      const playerClass = await classService.getClassById(progress.class_id);
      if (playerClass) {
        className = `${playerClass.icon} ${playerClass.name}`;
        
        // Add necromancer-specific info
        if (playerClass.code === 'necromancer') {
          const bossSouls = Array.isArray(progress.necro_boss_souls) ? progress.necro_boss_souls : [];
          const mobSouls = progress.necro_mob_souls || 0;
          
          necromancerInfo = `\n\n☠️ **Подчиненные души:**\n`;
          necromancerInfo += `💀 Души мобов: ${mobSouls}/15\n`;
          
          if (bossSouls.length > 0) {
            necromancerInfo += `👹 Души боссов: ${bossSouls.length}/2\n`;
            bossSouls.forEach((soul, idx) => {
              necromancerInfo += `  ${idx + 1}. ${formatBossIcon(soul.boss_config ?? {})} ${soulDisplayName(soul)} (этаж ${soul.floor})\n`;
            });
          } else {
            necromancerInfo += `👹 Души боссов: 0/2\n`;
          }
          
          // Show active effects
          if (progress.necro_bonus_games > 0) {
            necromancerInfo += `\n✨ Бонус активен: +${progress.necro_attack_bonus} ATK, +${progress.necro_defense_bonus} DEF (${progress.necro_bonus_games} игр)\n`;
          }
          if (progress.necro_debuff_games > 0) {
            necromancerInfo += `\n💀 Дебафф активен: -20% ATK, -10% DEF (${progress.necro_debuff_games} игр)\n`;
          }
        }
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
      chatInfo = `\n${ce(CUSTOM_EMOJI.home, '🏠')} Чат: ${chatType}\n` +
                 `${ce(CUSTOM_EMOJI.floor, '🏰')} Этаж в чате: ${chatProgress.current_floor}\n` +
                 `${ce(CUSTOM_EMOJI.floor, '🏰')} Макс. этаж в чате: ${chatProgress.highest_floor_reached}`;
    }

    const message = `${ce(CUSTOM_EMOJI.status, '📊')} **Статус игрока**\n\n` +
      `${ce(CUSTOM_EMOJI.user, '👤')} ${user.first_name}\n` +
      `${ce(CUSTOM_EMOJI.class, '🎭')} Класс: ${className}\n` +
      `${ce(CUSTOM_EMOJI.season, '🏆')} Сезон: ${season.season_number}\n\n` +
      `${ce(CUSTOM_EMOJI.planet, '🌍')} **Глобальный прогресс:**\n` +
      `${ce(CUSTOM_EMOJI.floor, '🏰')} Этаж (рекорд): ${progress.floor}\n` +
      `${ce(CUSTOM_EMOJI.checkpoint, '🚩')} Checkpoint: ${progress.checkpoint_floor}\n` +
      `❤️ HP: ${formatHealthBar(progress.hp, progress.max_hp)}\n` +
      `${ce(CUSTOM_EMOJI.attack, '⚔️')} Атака: ${progress.attack}\n` +
      `${ce(CUSTOM_EMOJI.defense, '🛡️')} Защита: ${progress.defense}\n` +
      `⭐ Уровень: ${PlayerProgressModel.calculateLevel(progress.highest_floor_reached)}\n` +
      `${ce(CUSTOM_EMOJI.gold, '💰')} Золото: ${progress.gold}\n` +
      `${ce(CUSTOM_EMOJI.nft, '🎖')} NFT поймано: ${progress.nfts_caught ?? 0}\n` +
      necromancerInfo +
      chatInfo +
      combatInfo +
      healthWarning +
      `\n⏱️ Следующее действие: ${cooldownText}`;

    // Create keyboard with action buttons
    const keyboard = new InlineKeyboard()
      .text('🏪 Маркет', `status:market:${telegramUserId}`)
      .text('🎒 Инвентарь', `status:inventory:${telegramUserId}`)
      .row()
      .text('⚔️ Экипировка', `status:equipment:${telegramUserId}`)
      .text('📌 Пин', `status:pin:${telegramUserId}`)
      .row()
      .text('♻️ Сброс', `status:reset:${telegramUserId}`);

    // The statistics button unlocks once the first tournament has ended.
    const finishedSeason = await SeasonModel.getLastFinishedSeason();
    if (finishedSeason) {
      keyboard.row().text('📊 Статистика', `status:stats:${telegramUserId}`);
    }

    // Add slots button only in private chats
    if (isPrivateChat) {
      keyboard.row().text('🎰 Лоты', `status:slots:${telegramUserId}`);
    }

    return { message, keyboard };
  }

  async getResetMenu(
    telegramUserId: number
  ): Promise<{ message: string; keyboard: InlineKeyboard }> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) {
      return {
        message: 'Пользователь не найден. Отправьте /start в личном чате с ботом.',
        keyboard: new InlineKeyboard(),
      };
    }

    const season = await SeasonModel.getOrCreateCurrentSeason();
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) {
      return {
        message: 'Прогресс не найден. Начните игру!',
        keyboard: new InlineKeyboard(),
      };
    }

    if (progress.reset_used) {
      return {
        message:
          `♻️ **Сброс недоступен**\n\n` +
          `Вы уже использовали сброс в сезоне ${season.season_number}.\n` +
          `Следующий сброс будет доступен в новом сезоне.`,
        keyboard: new InlineKeyboard(),
      };
    }

    const keyboard = new InlineKeyboard()
      .text('♻️ Подтвердить сброс', `reset:confirm:${telegramUserId}`)
      .row()
      .text('❌ Отмена', `reset:cancel:${telegramUserId}`)
      .row()
      .text('📊 Статус', `status:back:${telegramUserId}`);

    return {
      message:
        `⚠️ **Сброс прогресса**\n\n` +
        `Сброс доступен **1 раз за сезон**.\n\n` +
        `Будут сброшены до нуля:\n` +
        `• класс — потребуется выбрать заново\n` +
        `• этаж, рекорд, уровень, опыт\n` +
        `• золото, инвентарь и экипировка\n` +
        `• достижения и прочая статистика\n\n` +
        `❗ Действие необратимо. Продолжить?`,
      keyboard,
    };
  }

  async getPinMenu(
    telegramUserId: number
  ): Promise<{ message: string; keyboard: InlineKeyboard; hasPins: boolean }> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) {
      return {
        message: 'Пользователь не найден. Отправьте /start в личном чате с ботом.',
        keyboard: new InlineKeyboard(),
        hasPins: false,
      };
    }

    const season = await SeasonModel.getOrCreateCurrentSeason();
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) {
      return {
        message: 'Прогресс не найден. Начните игру!',
        keyboard: new InlineKeyboard(),
        hasPins: false,
      };
    }

    const pins = Array.isArray(progress.boss_pins) ? progress.boss_pins : [];
    if (pins.length === 0) {
      return {
        message:
          `📌 **Пины**\n\n` +
          `У вас пока нет ни одного пина.\n` +
          `Побеждайте боссов — каждый даёт свой эмодзи в коллекцию.`,
        keyboard: new InlineKeyboard().text('📊 Статус', `status:back:${telegramUserId}`),
        hasPins: false,
      };
    }

    const activeEmojiId = progress.active_pin?.boss_config?.custom_emoji_id;
    let message = `📌 **Смена пина**\n\n**Ваши пины:**\n`;
    pins.forEach((pin, index) => {
      const isActive = activeEmojiId && pin.boss_config?.custom_emoji_id === activeEmojiId;
      message += `${index + 1}. ${formatBossIcon(pin.boss_config ?? {})} ${pin.name} (этаж ${pin.floor})` +
        `${isActive ? ' — установлен' : ''}\n`;
    });
    message += `\n✏️ Введите номер пина, чтобы он отображался рядом с вашим ником в /top.`;

    return {
      message,
      keyboard: new InlineKeyboard().text('📊 Статус', `status:back:${telegramUserId}`),
      hasPins: true,
    };
  }

  async setPin(
    telegramUserId: number,
    index: number
  ): Promise<{ success: boolean; message: string }> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) {
      return { success: false, message: 'Пользователь не найден. Отправьте /start.' };
    }

    const season = await SeasonModel.getOrCreateCurrentSeason();
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) {
      return { success: false, message: 'Прогресс не найден. Начните игру!' };
    }

    const pins = Array.isArray(progress.boss_pins) ? progress.boss_pins : [];
    if (!Number.isInteger(index) || index < 1 || index > pins.length) {
      return {
        success: false,
        message: `❌ Пин с таким номером не найден. Введите число от 1 до ${pins.length}.`,
      };
    }

    const pin = pins[index - 1];
    await db.query(
      'UPDATE player_progress SET active_pin = $2::jsonb, updated_at = NOW() WHERE id = $1',
      [progress.id, JSON.stringify(pin)]
    );

    return {
      success: true,
      message: `✅ Пин установлен: ${formatBossIcon(pin.boss_config ?? {})} ${pin.name}\n` +
        `Он будет отображаться рядом с вашим ником в /top.`,
    };
  }

  async resetPlayer(
    telegramUserId: number
  ): Promise<{ message: string; keyboard: InlineKeyboard }> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) {
      return {
        message: 'Пользователь не найден. Отправьте /start в личном чате с ботом.',
        keyboard: new InlineKeyboard(),
      };
    }

    const season = await SeasonModel.getOrCreateCurrentSeason();
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) {
      return {
        message: 'Прогресс не найден. Начните игру!',
        keyboard: new InlineKeyboard(),
      };
    }

    if (progress.reset_used) {
      return {
        message:
          `♻️ **Сброс недоступен**\n\n` +
          `Вы уже использовали сброс в сезоне ${season.season_number}.`,
        keyboard: new InlineKeyboard(),
      };
    }

    try {
      await db.transaction(async (client) => {
        // Lock the row so a double tap cannot spend the reset twice.
        const locked = await client.query(
          'SELECT reset_used FROM player_progress WHERE id = $1 FOR UPDATE',
          [progress.id]
        );
        if (!locked.rows[0] || locked.rows[0].reset_used) {
          throw new Error('RESET_ALREADY_USED');
        }

        await client.query(
          `UPDATE player_progress
           SET class_id = NULL,
               floor = 1,
               highest_floor_reached = 1,
               hp = 100,
               max_hp = 100,
               attack = 10,
               defense = 5,
               crit_chance = 0,
               dodge = 0,
               lifesteal = 0,
               ai_resist = 0,
               equipment_effects = '[]'::jsonb,
               gold = 0,
               xp = 0,
               level = 1,
               checkpoint_floor = 1,
               trail_modifier = 1,
               necro_mob_souls = 0,
               necro_boss_souls = '[]'::jsonb,
               necro_pending_soul = NULL,
               necro_sacrifice_available_at = NULL,
               necro_debuff_games = 0,
               necro_attack_bonus = 0,
               necro_defense_bonus = 0,
               necro_bonus_games = 0,
               necro_summon_effect = NULL,
               boss_pins = '[]'::jsonb,
               active_pin = NULL,
               total_wins = 0,
               total_deaths = 0,
               reset_used = true,
               updated_at = NOW()
           WHERE id = $1`,
          [progress.id]
        );

        await client.query(
          'DELETE FROM player_inventory WHERE player_progress_id = $1',
          [progress.id]
        );
        await client.query(
          'DELETE FROM player_equipment WHERE player_progress_id = $1',
          [progress.id]
        );
        await client.query(
          'DELETE FROM player_achievements WHERE player_progress_id = $1',
          [progress.id]
        );
        await client.query(
          'DELETE FROM trail_markets WHERE player_progress_id = $1',
          [progress.id]
        );
        await client.query(
          `UPDATE chat_progress
           SET current_floor = 1, highest_floor_reached = 1, updated_at = NOW()
           WHERE user_id = $1 AND season_id = $2`,
          [user.id, season.id]
        );
        await client.query(
          'DELETE FROM combat_state WHERE user_id = $1 AND season_id = $2',
          [user.id, season.id]
        );
        await client.query(
          'DELETE FROM trail_events WHERE user_id = $1 AND season_id = $2',
          [user.id, season.id]
        );
        await client.query(
          'DELETE FROM behavior_profiles WHERE user_id = $1 AND season_id = $2',
          [user.id, season.id]
        );
        await client.query('DELETE FROM cooldowns WHERE user_id = $1', [user.id]);
      });
    } catch (error: any) {
      if (error?.message === 'RESET_ALREADY_USED') {
        return {
          message:
            `♻️ **Сброс недоступен**\n\n` +
            `Вы уже использовали сброс в сезоне ${season.season_number}.`,
          keyboard: new InlineKeyboard(),
        };
      }
      throw error;
    }

    const keyboard = new InlineKeyboard().text('🎭 Выбрать класс', 'classpage:0');

    return {
      message:
        `♻️ **Прогресс сброшен**\n\n` +
        `Вся статистика обнулена. Сброс использован: 1 раз за сезон ${season.season_number}.\n\n` +
        `Выберите класс заново и начните восхождение с начала.`,
      keyboard,
    };
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
    msg += `${ce(CUSTOM_EMOJI.gold, '💰')} Золото: ${progress.gold}\n\n`;

    if (equipment) {
      msg += `${ce(CUSTOM_EMOJI.attack, '⚔️')} **Экипировка:**\n`;
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
    return equipped.success ? '✅ Предмет экипирован.' : `❌ Нельзя экипировать этот предмет: ${equipped.reason}`;
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
              i.lifesteal_bonus, i.ai_resist_bonus, i.special_effect, pi.quantity,
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
    
    // Slot selection buttons
    keyboard
      .text('⚔️', `equipmenu:weapon:0:${telegramUserId}`)
      .text('🛡', `equipmenu:shield:0:${telegramUserId}`)
      .text('🪖', `equipmenu:helmet:0:${telegramUserId}`)
      .row()
      .text('🥋', `equipmenu:armor:0:${telegramUserId}`)
      .text('🥾', `equipmenu:boots:0:${telegramUserId}`)
      .text('💍', `equipmenu:accessory:0:${telegramUserId}`)
      .row();
    
    // Build message with item details
    let message = `🎒 **Экипировка — ${slotNames[selectedSlot]}**\n\n`;
    
    if (rows.length === 0) {
      message += `У вас нет предметов в этой категории.\n`;
    } else {
      message += `📋 **Доступные предметы (стр. ${safePage + 1}/${totalPages}):**\n\n`;
      
      for (const item of rows) {
        const equipped = Number(item[currentColumn]) === Number(item.id);
        const rarityEmoji = this.getRarityEmoji(item.rarity);
        
        // Format stats
        const statsParts = [];
        if (item.attack_bonus > 0) statsParts.push(`+${item.attack_bonus} ATK`);
        if (item.defense_bonus > 0) statsParts.push(`+${item.defense_bonus} DEF`);
        if (item.hp_bonus > 0) statsParts.push(`+${item.hp_bonus} HP`);
        if (item.crit_chance_bonus > 0) statsParts.push(`+${item.crit_chance_bonus}% CRIT`);
        if (item.dodge_bonus > 0) statsParts.push(`+${item.dodge_bonus}% DODGE`);
        if (item.lifesteal_bonus > 0) statsParts.push(`+${item.lifesteal_bonus}% LIFESTEAL`);
        if (item.ai_resist_bonus > 0) statsParts.push(`+${item.ai_resist_bonus}% AI RES`);
        
        const stats = statsParts.length > 0 ? statsParts.join(', ') : 'нет базовых стат';
        const special = item.special_effect ? `\n   🌟 *${item.special_effect}*` : '';
        const equippedMark = equipped ? ' ✅' : '';
        
        message += `${rarityEmoji} **${item.name}**${equippedMark}\n`;
        message += `   📊 ${stats}${special}\n\n`;
        
        // Add button for this item
        keyboard.text(
          `${equipped ? '✅ ' : ''}${item.name}`,
          `equipitem:${item.id}:${selectedSlot}:${safePage}:${telegramUserId}`
        ).style(equipped ? 'success' : 'primary').row();
      }
    }
    
    // Pagination buttons
    if (totalPages > 1) {
      keyboard
        .text('⬅️', `equipmenu:${selectedSlot}:${Math.max(0, safePage - 1)}:${telegramUserId}`)
        .text(`${safePage + 1}/${totalPages}`, `equipmenu:${selectedSlot}:${safePage}:${telegramUserId}`)
        .text('➡️', `equipmenu:${selectedSlot}:${Math.min(totalPages - 1, safePage + 1)}:${telegramUserId}`)
        .row();
    }
    
    message += `\n💡 Нажмите на предмет чтобы надеть/снять.`;
    keyboard.row().text('📊 Статус', `status:back:${telegramUserId}`);
    
    return {
      message,
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
      const removed = await lootService.unequipItem(progress.id, slot);
      return removed ? '✅ Предмет снят.' : '❌ Не удалось снять предмет.';
    }
    const result = await lootService.equipItem(progress.id, itemId);
    return result.success ? '✅ Предмет надет.' : `❌ ${result.reason}`;
  }

  async getPotionMenu(
    telegramUserId: number,
    telegramChatId: number
  ): Promise<{ message: string; keyboard: InlineKeyboard }> {
    const keyboard = new InlineKeyboard();
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) return { message: 'Пользователь не найден.', keyboard };
    const chat = await ChatModel.findByTelegramChatId(telegramChatId);
    const season = await SeasonModel.getCurrentSeason();
    if (!chat || !season) return { message: 'Чат или сезон не найден.', keyboard };
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) return { message: 'Прогресс не найден.', keyboard };

    const combatState = await CombatStateModel.find(user.id, season.id, chat.id);
    if (!combatState) {
      return { message: '🧪 Боевые зелья можно использовать только во время боя.', keyboard };
    }
    if (combatState.enemy_data?.potionUsed) {
      return { message: '🧪 Зелье уже использовано в этом бою.', keyboard };
    }

    const choices = await potionService.getPotionChoices(progress.id);
    if (!choices.length) {
      return { message: '🧪 У вас нет зелий здоровья.', keyboard };
    }

    const lines = choices.map((choice) => {
      const heal = choice.heal_type === 'percentage'
        ? `${choice.heal_value}% от макс. HP`
        : `${choice.heal_value} HP`;
      return `${choice.icon} **${choice.name}** ×${choice.quantity} — ${heal}`;
    });
    choices.forEach((choice) => {
      keyboard.text(`${choice.icon} ${choice.name} (${choice.quantity})`, `potion:use:${choice.itemId}`).row();
    });

    return {
      message: `🧪 **Выберите зелье**\n\n` +
        `❤️ HP: **${progress.hp}/${progress.max_hp}**\n\n` +
        `${lines.join('\n')}\n\n` +
        `Лечение не расходует ход и не ставит кулдаун.`,
      keyboard,
    };
  }

  async usePotion(
    telegramUserId: number,
    telegramChatId: number,
    itemId: number
  ): Promise<{ message: string; keyboard?: InlineKeyboard }> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) return { message: 'Пользователь не найден.' };
    const chat = await ChatModel.findByTelegramChatId(telegramChatId);
    const season = await SeasonModel.getCurrentSeason();
    if (!chat || !season) return { message: 'Чат или сезон не найден.' };
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) return { message: 'Прогресс не найден.' };

    // Reserve the potion and consume it inside one transaction: the combat row,
    // the inventory row and the player HP row are locked together, so parallel
    // requests cannot spend the same potion and a failure rolls everything back
    // (potionUsed is never left stuck at true).
    const outcome = await db.transaction(async (client) => {
      const stateResult = await client.query(
        'SELECT id, enemy_data FROM combat_state WHERE user_id = $1 AND season_id = $2 AND chat_id = $3 FOR UPDATE',
        [user.id, season.id, chat.id]
      );
      if (!stateResult.rows[0]) {
        return { type: 'no_combat' as const };
      }
      if (stateResult.rows[0].enemy_data?.potionUsed) {
        return { type: 'already_used' as const };
      }
      const result = await potionService.usePotionById(progress.id, itemId, client);
      if (!result.success) {
        return { type: 'failed' as const, message: result.message };
      }
      await client.query(
        `UPDATE combat_state SET enemy_data = jsonb_set(enemy_data, '{potionUsed}', 'true'::jsonb), updated_at = NOW() WHERE id = $1`,
        [stateResult.rows[0].id]
      );
      return { type: 'used' as const, message: result.message };
    });

    if (outcome.type === 'no_combat') {
      return { message: '🧪 Боевые зелья можно использовать только во время боя.' };
    }
    if (outcome.type === 'already_used') {
      return { message: '🧪 Зелье уже использовано в этом бою.' };
    }
    return { message: outcome.message };
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
      const soulEmojiId = boss.boss_config?.custom_emoji_id;
      keyboard.text(`${soulEmojiId ? '' : '☠️ '}${soulDisplayName(boss)} · ${boss.floor} этаж`, `sacrifice:boss:${index}`).icon(soulEmojiId).row();
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
    
    // NEW RITUAL SYSTEM: Guaranteed percentage bonuses, no random failure
    let attackBonusPercent = 0;
    let defenseBonusPercent = 0;
    let duration = 3; // combat actions
    let sacrificeName = '';
    
    if (target === 'mobs') {
      // 3 mob souls: small guaranteed bonus
      attackBonusPercent = 8;
      defenseBonusPercent = 8;
      sacrificeName = '3 души мобов';
    } else {
      // Boss soul: bonus scales with floor
      const floor = bosses[bossIndex!].floor;
      sacrificeName = `${formatBossIcon(bosses[bossIndex!].boss_config ?? {})} ${soulDisplayName(bosses[bossIndex!])} (этаж ${floor})`;
      
      if (floor <= 100) {
        attackBonusPercent = 12;
        defenseBonusPercent = 10;
      } else if (floor <= 300) {
        attackBonusPercent = 18;
        defenseBonusPercent = 14;
      } else {
        attackBonusPercent = 22;
        defenseBonusPercent = 16;
      }
    }
    
    // Calculate actual bonuses from current stats (with equipment)
    const attackBonus = Math.floor(progress.attack * (attackBonusPercent / 100));
    const defenseBonus = Math.floor(progress.defense * (defenseBonusPercent / 100));
    
    // Clear any existing debuff and apply new bonus
    await db.query(
      `UPDATE player_progress
       SET necro_mob_souls = CASE WHEN $2 = 'mobs' THEN necro_mob_souls - 3 ELSE necro_mob_souls END,
           necro_boss_souls = CASE WHEN $2 = 'boss' THEN (
             SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) FROM jsonb_array_elements(necro_boss_souls) WITH ORDINALITY t(value, ord)
             WHERE ord <> $3
           ) ELSE necro_boss_souls END,
           necro_sacrifice_available_at = NOW() + INTERVAL '2 hours',
           necro_debuff_games = 0,
           necro_attack_bonus = $4,
           necro_defense_bonus = $5,
           necro_bonus_games = $6
       WHERE id = $1`,
      [progress.id, target, (bossIndex ?? -1) + 1, attackBonus, defenseBonus, duration]
    );
    
    return `✨ **Жертвоприношение успешно!**\n\n` +
      `🔮 Принесено в жертву: ${sacrificeName}\n` +
      `${ce(CUSTOM_EMOJI.attack, '⚔️')} Получено: +${attackBonus} атаки (+${attackBonusPercent}%)\n` +
      `${ce(CUSTOM_EMOJI.defense, '🛡️')} Получено: +${defenseBonus} защиты (+${defenseBonusPercent}%)\n` +
      `⏳ Действует: ${duration} боевых действия\n\n` +
      `💀 Сила мёртвых течёт в ваших венах!`;
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

  async replaceBossSoul(telegramUserId: number, bossIndex: number): Promise<string> {
    const progress = await this.getProgressForTelegramUser(telegramUserId);
    const playerClass = progress.class_id ? await classService.getClassById(progress.class_id) : null;
    if (playerClass?.name !== 'Некромант') return '❌ Доступно только Некроманту.';
    
    const pendingSoul = progress.necro_pending_soul;
    if (!pendingSoul) return '❌ Нет души для замены.';
    
    const souls = Array.isArray(progress.necro_boss_souls) ? progress.necro_boss_souls : [];
    if (bossIndex < 0 || bossIndex >= souls.length) return '❌ Неверный индекс души.';
    
    const replacedSoul = souls[bossIndex];
    
    // Replace the soul at the specified index
    await db.query(
      `UPDATE player_progress
       SET necro_boss_souls = (
         SELECT jsonb_agg(
           CASE 
             WHEN ord = $2 THEN $3::jsonb
             ELSE value
           END
         )
         FROM jsonb_array_elements(necro_boss_souls) WITH ORDINALITY t(value, ord)
       ),
       necro_pending_soul = NULL,
       updated_at = NOW()
       WHERE id = $1`,
      [progress.id, bossIndex + 1, JSON.stringify(pendingSoul)]
    );
    
    return `☠️ Душа ${formatBossIcon(replacedSoul.boss_config ?? {})} ${soulDisplayName(replacedSoul)} принесена в жертву.\n✨ Душа ${formatBossIcon(pendingSoul.boss_config ?? {})} ${soulDisplayName(pendingSoul)} поглощена!`;
  }

  async declineBossSoul(telegramUserId: number): Promise<void> {
    const progress = await this.getProgressForTelegramUser(telegramUserId);
    await db.query(
      'UPDATE player_progress SET necro_pending_soul = NULL WHERE id = $1',
      [progress.id]
    );
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
    action: 'buy' | 'sell' | 'exchange',
    itemIndex?: any
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
      action,
      itemIndex
    );
    return { success: true, message: result.message, keyboard: result.keyboard };
  }

  /**
   * Get daily market with pagination
   */
  async getDailyMarket(
    telegramUserId: number,
    page: number = 0
  ): Promise<{ message: string; keyboard: InlineKeyboard }> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) throw new Error('Пользователь не найден.');
    
    const season = await SeasonModel.getCurrentSeason();
    if (!season) throw new Error('Сезон не найден.');
    
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) throw new Error('Прогресс не найден.');
    
    const items = await dailyMarketService.getTodayMarket();
    const { message, totalPages } = dailyMarketService.generateMarketMessage(
      items,
      progress.gold,
      page
    );
    const keyboard = dailyMarketService.generateMarketKeyboard(items, page, telegramUserId);
    
    return { message, keyboard };
  }

  /**
   * Buy item from daily market
   */
  async buyFromDailyMarket(
    telegramUserId: number,
    itemIndex: number
  ): Promise<{ success: boolean; message: string }> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) return { success: false, message: 'Пользователь не найден.' };
    
    const season = await SeasonModel.getCurrentSeason();
    if (!season) return { success: false, message: 'Сезон не найден.' };
    
    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) return { success: false, message: 'Прогресс не найден.' };
    
    return await dailyMarketService.buyItem(progress.id, itemIndex);
  }

  /**
   * Sell menu of the daily market: the player's inventory with sell prices.
   */
  async getDailyMarketSellMenu(
    telegramUserId: number,
    page: number = 0
  ): Promise<{ message: string; keyboard: InlineKeyboard }> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) throw new Error('Пользователь не найден.');

    const season = await SeasonModel.getCurrentSeason();
    if (!season) throw new Error('Сезон не найден.');

    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) throw new Error('Прогресс не найден.');

    const inventory = await lootService.getInventory(progress.id);
    return dailyMarketService.generateSellMenu(inventory, progress.gold, page, telegramUserId);
  }

  /**
   * Sell one item from the daily market.
   */
  async sellFromDailyMarket(
    telegramUserId: number,
    itemId: number
  ): Promise<{ success: boolean; message: string }> {
    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) return { success: false, message: 'Пользователь не найден.' };

    const season = await SeasonModel.getCurrentSeason();
    if (!season) return { success: false, message: 'Сезон не найден.' };

    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) return { success: false, message: 'Прогресс не найден.' };

    return await merchantService.sellItem(progress.id, itemId);
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

  /**
   * Выбирает фактическое действие врага. Действие, совпадающее с прогнозом,
   * получает повышенный вес, но совпадение не гарантируется.
   */
  private rollEnemyAction(forecast: ActionType): ActionType {
    const attackWeight = forecast === ActionType.ATTACK ? PREDICTION_ACTION_BIAS : 1;
    const defendWeight = forecast === ActionType.DEFEND ? PREDICTION_ACTION_BIAS : 1;
    return Math.random() * (attackWeight + defendWeight) < attackWeight
      ? ActionType.ATTACK
      : ActionType.DEFEND;
  }
}

export const gameService = new GameService();