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
    parse_mode: 'HTML',
    reply_parameters: {
      message_id: ctx.message.message_id,
    },
  });
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
