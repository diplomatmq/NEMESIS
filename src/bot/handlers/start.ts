import { Context } from 'grammy';
import { UserModel } from '../../database/models/User';

export async function handleStart(ctx: Context) {
  if (!ctx.from) {
    return;
  }

  // Check if this is a private chat (not a group)
  if (ctx.chat?.type !== 'private') {
    await ctx.reply(
      '⚠️ Команда /start работает только в личных сообщениях с ботом.\n\n' +
      'Откройте личный чат с ботом и отправьте /start там.'
    );
    return;
  }

  const telegramId = ctx.from.id;
  const username = ctx.from.username;
  const firstName = ctx.from.first_name;
  const lastName = ctx.from.last_name;

  // Check if user exists
  let user = await UserModel.findByTelegramId(telegramId);

  if (user) {
    // User exists, update last start time
    await UserModel.updateLastStart(telegramId);
    
    await ctx.reply(
      `👋 С возвращением, ${firstName}!\n\n` +
      `🏰 NEMESIS - Башня Забвения\n\n` +
      `🎮 Вы можете продолжить игру в любом групповом чате, где добавлен бот.\n\n` +
      `⚔️ Доступные команды:\n` +
      `• атака - атаковать противника\n` +
      `• защита - защититься от атаки\n` +
      `• /status - посмотреть свой прогресс\n` +
      `• /inventory - открыть инвентарь\n` +
      `• /class - выбрать класс\n` +
      `• /achievements - достижения\n\n` +
      `⏳ Между действиями - КД 10 минут.\n` +
      `⭐ Можно пропустить КД за 1 Telegram Star.`
    );
  } else {
    // New user, create record
    await UserModel.create({
      telegram_id: telegramId,
      username,
      first_name: firstName,
      last_name: lastName,
    });

    await ctx.reply(
      `🎉 Добро пожаловать в NEMESIS!\n\n` +
      `🏰 Башня Забвения ждёт вас...\n\n` +
      `📜 О игре:\n` +
      `Вы начинаете восхождение по башне из 500 этажей.\n` +
      `Каждый этаж - новое испытание.\n` +
      `Каждый 10-й этаж - босс.\n\n` +
      `⚔️ Основные команды:\n` +
      `• атака - атаковать противника\n` +
      `• защита - защититься от атаки\n` +
      `• /status - посмотреть прогресс\n` +
      `• /inventory - открыть инвентарь\n` +
      `• /class - выбрать класс\n` +
      `• /achievements - достижения\n\n` +
      `⏳ Между действиями есть КД 10 минут.\n` +
      `⭐ КД можно пропустить за 1 Telegram Star.\n\n` +
      `🚀 Добавьте бота в групповой чат и начните игру!`
    );
  }
}
