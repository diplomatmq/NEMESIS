import { Context } from 'grammy';
import { classService } from '../../game/ClassService';
import { UserModel } from '../../database/models/User';
import { ChatModel } from '../../database/models/Chat';
import { SeasonModel } from '../../database/models/Season';
import { PlayerProgressModel } from '../../database/models/PlayerProgress';

export async function handleClassSelection(ctx: Context) {
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
  const progress = await PlayerProgressModel.findOrCreate(user!.id, season.id);

  // Check if class already selected
  if (progress.class_id) {
    const currentClass = await classService.getClassById(progress.class_id);
    await ctx.reply(
      `🎭 Ваш класс: ${currentClass?.icon} **${currentClass?.name}**\n\n` +
      `Класс можно изменить только в начале нового сезона.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Show class selection
  const description = classService.generateClassDescription();
  const keyboard = classService.generateClassSelectionKeyboard();

  await ctx.reply(description, {
    reply_markup: keyboard,
    parse_mode: 'Markdown',
  });
}

export async function handleClassCallback(ctx: Context) {
  if (!ctx.from || !ctx.chat || !ctx.callbackQuery?.data) {
    return;
  }

  const data = ctx.callbackQuery.data;
  
  if (!data.startsWith('class:')) {
    return;
  }

  const classCode = data.replace('class:', '');

  // Get class info
  const gameClass = await classService.getClassByCode(classCode);
  if (!gameClass) {
    await ctx.answerCallbackQuery('Класс не найден.');
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
  const progress = await PlayerProgressModel.findOrCreate(user!.id, season.id);

  // Check if class already selected
  if (progress.class_id) {
    await ctx.answerCallbackQuery('Класс уже выбран!');
    return;
  }

  // Set player class
  await classService.setPlayerClass(progress.id, gameClass.id);

  await ctx.answerCallbackQuery(`Выбран класс: ${gameClass.name}`);
  
  await ctx.editMessageText(
    `✅ Вы выбрали класс: ${gameClass.icon} **${gameClass.name}**\n\n` +
    `📜 ${gameClass.description}\n\n` +
    `💪 Характеристики:\n` +
    `❤️ HP: ${gameClass.base_hp}\n` +
    `⚔️ Атака: ${gameClass.base_attack}\n` +
    `🛡️ Защита: ${gameClass.base_defense}\n\n` +
    `🎮 Теперь начните восхождение по башне!\n` +
    `Используйте команды: атака, защита`,
    { parse_mode: 'Markdown' }
  );
}
