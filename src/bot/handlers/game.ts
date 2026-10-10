import { Context } from 'grammy';
import { gameService } from '../../game/GameService';
import { InvoiceService } from '../../payment/InvoiceService';
import { markdownToTelegramHtml } from '../../game/HealthBar';

export async function handleGameAction(ctx: Context, invoiceService: InvoiceService) {
  if (!ctx.from || !ctx.chat || !ctx.message?.text) {
    return;
  }

  const action = ctx.message.text.trim();

  // Execute action
  const result = await gameService.executeAction(
    {
      telegramUserId: ctx.from.id,
      telegramChatId: ctx.chat.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      chatType: ctx.chat.type,
      chatTitle: 'title' in ctx.chat ? ctx.chat.title : undefined,
    },
    action,
    false // not bypassing cooldown
  );

  // If cooldown is active and payment needed
  if (result.needsPayment && result.cooldownInfo) {
    // Create invoice
    const { keyboard } = await invoiceService.createSkipCooldownInvoice(
      ctx.from.id,
      ctx.chat.id,
      action
    );

    await ctx.reply(markdownToTelegramHtml(result.message), {
      reply_markup: keyboard,
      parse_mode: 'HTML',
      reply_parameters: {
        message_id: ctx.message.message_id,
      },
    });
    return;
  }

  // Send result message
  await ctx.reply(markdownToTelegramHtml(result.message), {
    reply_markup: result.keyboard,
    parse_mode: 'HTML',
    reply_parameters: {
      message_id: ctx.message.message_id,
    },
  });
  if (result.privateMessage) {
    await ctx.api.sendMessage(ctx.from.id, result.privateMessage);
  }
}

export async function handleTrailCallback(ctx: Context) {
  if (!ctx.from || !ctx.chat || !ctx.callbackQuery?.data) return;
  const data = ctx.callbackQuery.data;
  const trailMatch = /^trail:(\d+):(\d+)$/.exec(data);
  const marketMatch = /^trailmarket:(\d+):(\d+)$/.exec(data);
  const marketActionMatch = /^marketaction:(\d+):(buy|sell|exchange)$/.exec(data);
  if (!trailMatch && !marketMatch && !marketActionMatch) return;

  const result = marketActionMatch
    ? await gameService.resolveTrailMarketAction(
        ctx.from.id,
        ctx.chat.id,
        Number(marketActionMatch[1]),
        marketActionMatch[2] as 'buy' | 'sell' | 'exchange'
      )
    : trailMatch
    ? await gameService.resolveTrail(
        ctx.from.id,
      ctx.chat.id,
      Number(trailMatch[1]),
      Number(trailMatch[2])
    )
    : await gameService.resolveTrailMarket(
      ctx.from.id,
      ctx.chat.id,
      Number(marketMatch![1]),
      Number(marketMatch![2])
    );

  await ctx.answerCallbackQuery(result.message.slice(0, 190));
  if (ctx.callbackQuery.message) {
    await ctx.editMessageText(markdownToTelegramHtml(result.message), {
      parse_mode: 'HTML',
      reply_markup: result.keyboard,
    });
  }
}

export async function handleStatus(ctx: Context) {
  if (!ctx.from || !ctx.chat) {
    return;
  }

  const status = await gameService.getPlayerStatus(ctx.from.id, ctx.chat.id);
  await ctx.reply(markdownToTelegramHtml(status), { parse_mode: 'HTML' });
}

export async function handleInventory(ctx: Context) {
  if (!ctx.from || !ctx.chat) {
    return;
  }

  const inventory = await gameService.getInventory(ctx.from.id, ctx.chat.id);
  await ctx.reply(inventory, { parse_mode: 'Markdown' });
}

export async function handleEquipCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const match = /^equip:(\d+)$/.exec(ctx.callbackQuery.data);
  if (!match) return;
  const message = await gameService.equipItem(ctx.from.id, Number(match[1]));
  await ctx.answerCallbackQuery(message.slice(0, 190));
}

export async function handleEquipmentMenu(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const menu = /^equipmenu:(\w+):(\d+):(\d+)$/.exec(ctx.callbackQuery.data);
  const item = /^equipitem:(\d+):(\w+):(\d+):(\d+)$/.exec(ctx.callbackQuery.data);
  if (!menu && !item) return;
  
  // Check if user is authorized
  if (menu && Number(menu[3]) !== ctx.from.id) {
    await ctx.answerCallbackQuery('❌ Это не ваше меню!');
    return;
  }
  if (item && Number(item[4]) !== ctx.from.id) {
    await ctx.answerCallbackQuery('❌ Это не ваше меню!');
    return;
  }
  
  if (menu) {
    const result = await gameService.getEquipmentMenu(ctx.from.id, menu[1], Number(menu[2]));
    await ctx.answerCallbackQuery();
    if (ctx.callbackQuery.message) {
      await ctx.editMessageText(result.message, {
        reply_markup: result.keyboard,
        parse_mode: 'Markdown',
      });
    }
    return;
  }
  const result = await gameService.toggleEquipment(
    ctx.from.id,
    Number(item![1]),
    item![2]
  );
  await ctx.answerCallbackQuery(result.slice(0, 190));
  if (ctx.callbackQuery.message) {
    const refreshed = await gameService.getEquipmentMenu(ctx.from.id, item![2], Number(item![3]));
    await ctx.editMessageText(refreshed.message, {
      reply_markup: refreshed.keyboard,
      parse_mode: 'Markdown',
    });
  }
}

export async function handleSacrificeCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const data = ctx.callbackQuery.data;
  if (!data.startsWith('sacrifice:') || data.startsWith('sacrifice:skip:')) return;
  
  if (data === 'sacrifice:close') {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Меню жертвоприношения закрыто.');
    return;
  }
  
  // Handle soul replacement
  const replaceMatch = /^sacrifice:replace:(\d+)$/.exec(data);
  if (replaceMatch) {
    const message = await gameService.replaceBossSoul(ctx.from.id, Number(replaceMatch[1]));
    await ctx.answerCallbackQuery(message.slice(0, 190));
    await ctx.editMessageText(message);
    return;
  }
  
  // Handle decline
  if (data === 'sacrifice:decline') {
    await gameService.declineBossSoul(ctx.from.id);
    await ctx.answerCallbackQuery('Душа отвергнута');
    await ctx.editMessageText('❌ Вы отказались от поглощения души.');
    return;
  }

  const [, target, index] = data.split(':');
  const message = await gameService.sacrifice(ctx.from.id, target as 'mobs' | 'boss', index ? Number(index) : undefined);
  await ctx.answerCallbackQuery(message.slice(0, 190));
  await ctx.editMessageText(message);
}

export async function handleSacrificeCallbackWithPayment(
  ctx: Context,
  invoiceService: InvoiceService
) {
  if (!ctx.from || !ctx.chat || !ctx.callbackQuery?.data) return;
  const match = /^sacrifice:skip:(mobs|boss)(?::(\d+))?$/.exec(ctx.callbackQuery.data);
  if (!match) return;
  const command = `sacrifice_skip:${match[1]}${match[2] ? `:${match[2]}` : ''}`;
  const { keyboard } = await invoiceService.createSkipCooldownInvoice(
    ctx.from.id,
    ctx.chat.id,
    command,
    5,
    'Пропуск КД жертвоприношения'
  );
  await ctx.answerCallbackQuery();
  await ctx.reply('⏳ Ритуал ещё на cooldown. Пропустить его можно за 5 Telegram Stars.', {
    reply_markup: keyboard,
  });
}

export async function handleThroneCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const data = ctx.callbackQuery.data;
  if (!data.startsWith('throne:')) return;
  if (data === 'throne:skip') {
    await ctx.answerCallbackQuery('Души сохранены.');
    await ctx.editMessageText('👑 Трон из мёртвых отвергнут. Души сохранены.');
    return;
  }
  const match = /^throne:sacrifice:(\d+)$/.exec(data);
  if (!match) return;
  const result = await gameService.sacrifice(ctx.from.id, 'boss', Number(match[1]));
  await ctx.answerCallbackQuery(result.slice(0, 190));
  await ctx.editMessageText(result);
}

export async function handleUsePotion(ctx: Context) {
  if (!ctx.from || !ctx.chat) {
    return;
  }

  // Use potion through game action
  const result = await gameService.executeAction(
    {
      telegramUserId: ctx.from.id,
      telegramChatId: ctx.chat.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      chatType: ctx.chat.type,
      chatTitle: 'title' in ctx.chat ? ctx.chat.title : undefined,
    },
    'potion', // special action for using potion
    true // bypass cooldown for potion use
  );

  await ctx.reply(markdownToTelegramHtml(result.message), { parse_mode: 'HTML' });
}
