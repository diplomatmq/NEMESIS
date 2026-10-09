import { Context } from 'grammy';
import { UserModel } from '../../database/models/User';
import { SeasonModel } from '../../database/models/Season';
import { PlayerProgressModel } from '../../database/models/PlayerProgress';
import { getClassPage } from './class';

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
    user = await UserModel.create({
      telegram_id: telegramId,
      username,
      first_name: firstName,
      last_name: lastName,
    });

    const season = await SeasonModel.getOrCreateCurrentSeason();
    await PlayerProgressModel.findOrCreate(user.id, season.id);
    const page = await getClassPage(0);
    await ctx.reply(
      `🎉 Добро пожаловать в NEMESIS!\n\n` +
      `Вы начинаете восхождение по башне из 500 этажей.\n\n` +
      page.text,
      { reply_markup: page.keyboard, parse_mode: 'Markdown' }
    );
  }
}
