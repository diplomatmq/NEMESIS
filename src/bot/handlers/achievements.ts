import { Context } from 'grammy';
import { achievementService } from '../../game/AchievementService';
import { UserModel } from '../../database/models/User';
import { ChatModel } from '../../database/models/Chat';
import { SeasonModel } from '../../database/models/Season';
import { PlayerProgressModel } from '../../database/models/PlayerProgress';

export async function handleAchievements(ctx: Context) {
  if (!ctx.from || !ctx.chat) {
    return;
  }

  // Check if user has started
  const hasStarted = await UserModel.hasStarted(ctx.from.id);
  if (!hasStarted) {
    await ctx.reply('🎮 Сначала отправьте /start в личном чате с ботом.');
    return;
  }

  // Get player progress
  const user = await UserModel.findByTelegramId(ctx.from.id);
  const chat = await ChatModel.findOrCreate({
    telegram_chat_id: ctx.chat.id,
    chat_type: ctx.chat.type,
    title: 'title' in ctx.chat ? ctx.chat.title : undefined,
  });
  const season = await SeasonModel.getOrCreateCurrentSeason();
  const progress = await PlayerProgressModel.findOrCreate(user!.id, chat.id, season.id);

  // Get achievements
  const achievements = await achievementService.getPlayerAchievements(progress.id);
  const counts = await achievementService.getUnlockedCount(progress.id);

  let message = achievementService.formatAchievementsList(achievements);
  message += `\n\n📊 Прогресс: ${counts.unlocked}/${counts.total}`;

  await ctx.reply(message, { parse_mode: 'Markdown' });
}
