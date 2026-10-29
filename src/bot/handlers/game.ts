import { Context, InlineKeyboard } from 'grammy';
import { gameService } from '../../game/GameService';
import { trailService } from '../../game/TrailService';
import { UserModel } from '../../database/models/User';
import { ChatModel } from '../../database/models/Chat';
import { SeasonModel } from '../../database/models/Season';
import { PlayerProgressModel } from '../../database/models/PlayerProgress';
import { InvoiceService } from '../../payment/InvoiceService';
import { markdownToTelegramHtml } from '../../game/HealthBar';
import { stripCustomEmoji } from '../../game/BossSystem';
import { seasonService } from '../../game/SeasonService';
import { notifyAdmins } from './admin';

// Users waiting to type a pin number after opening the pin menu.
const pendingPinSelections = new Map<number, { timestamp: number }>();

/**
 * Callback alerts (answerCallbackQuery) are shown as plain text: no parse mode
 * is applied, so markdown markers would appear literally and custom-emoji tags
 * would be displayed as raw HTML. Reduce a game message to clean plain text.
 */
function formatAlert(message: string): string {
  return stripCustomEmoji(message)
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/~~(.+?)~~/gs, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`/g, '')
    .trim()
    .slice(0, 190);
}

export async function handleGameAction(ctx: Context, invoiceService: InvoiceService) {
  if (!ctx.from || !ctx.chat || !ctx.message?.text) {
    return;
  }

  const action = ctx.message.text.trim();

  try {
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
      const { keyboard } = await invoiceService.createSkipCooldownInvoice({
        telegramUserId: ctx.from.id,
        chatId: ctx.chat.id,
        command: action,
        replyToMessageId: ctx.message.message_id,
      });

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
    if (result.adminNotification) {
      await notifyAdmins(ctx.api, result.adminNotification);
    }
  } catch (error: any) {
    console.error('Error in handleGameAction:', error);
    await ctx.reply(`❌ Ошибка: ${error.message || 'Неизвестная ошибка'}`).catch(() => {});
  }
}

export async function handleTrailCallback(ctx: Context) {
  if (!ctx.from || !ctx.chat || !ctx.callbackQuery?.data) return;
  const data = ctx.callbackQuery.data;
  
  // Trail choice callback
  const trailMatch = /^trail:(\d+):(\d+)$/.exec(data);
  
  // Market callbacks - updated patterns
  const marketModeMatch = /^trailmarket:(\d+):mode:(buy|sell|exchange|main)$/.exec(data);
  const marketBuyMatch = /^trailmarket:(\d+):buy:(\d+)$/.exec(data);
  const marketSellMatch = /^trailmarket:(\d+):sell:(\d+)$/.exec(data);
  const marketSellPageMatch = /^trailmarket:(\d+):sellpage:(\d+)$/.exec(data);
  const marketExch1Match = /^trailmarket:(\d+):exch1:(\d+)$/.exec(data);
  const marketExch2Match = /^trailmarket:(\d+):exch2:(\d+):(\d+)$/.exec(data);
  const marketExchPageMatch = /^trailmarket:(\d+):exchpage:(\d+):(\d+)$/.exec(data);
  
  // Old market action match for backwards compatibility
  const marketActionMatch = /^marketaction:(\d+):(buy|sell|exchange)$/.exec(data);
  
  if (!trailMatch && !marketModeMatch && !marketBuyMatch && !marketSellMatch && 
      !marketSellPageMatch && !marketExch1Match && !marketExch2Match && 
      !marketExchPageMatch && !marketActionMatch) return;

  try {
    let result;
    
    if (trailMatch) {
      // Trail choice
      result = await gameService.resolveTrail(
        ctx.from.id,
        ctx.chat.id,
        Number(trailMatch[1]),
        Number(trailMatch[2])
      );
    } else if (marketModeMatch) {
      // Mode selection or back to main
      const [, marketId, mode] = marketModeMatch;
      
      if (mode === 'main') {
        // Show main market menu again
        const user = await UserModel.findByTelegramId(ctx.from.id);
        const season = await SeasonModel.getCurrentSeason();
        const progress = await PlayerProgressModel.find(user!.id, season!.id);
        const chat = await ChatModel.findByTelegramChatId(ctx.chat.id);
        
        result = await trailService.resolveMarketAction(
          user!.id,
          progress!.id,
          chat!.id,
          Number(marketId),
          'buy' as any, // Will show main menu
          undefined
        );
      } else {
        result = await gameService.resolveTrailMarketAction(
          ctx.from.id,
          ctx.chat.id,
          Number(marketId),
          mode as any
        );
      }
    } else if (marketBuyMatch) {
      // Execute buy
      result = await gameService.resolveTrailMarketAction(
        ctx.from.id,
        ctx.chat.id,
        Number(marketBuyMatch[1]),
        'buy',
        Number(marketBuyMatch[2])
      );
    } else if (marketSellMatch) {
      // Execute sell
      result = await gameService.resolveTrailMarketAction(
        ctx.from.id,
        ctx.chat.id,
        Number(marketSellMatch[1]),
        'sell',
        Number(marketSellMatch[2])
      );
    } else if (marketSellPageMatch) {
      // Sell pagination
      const user = await UserModel.findByTelegramId(ctx.from.id);
      const season = await SeasonModel.getCurrentSeason();
      const progress = await PlayerProgressModel.find(user!.id, season!.id);
      const chat = await ChatModel.findByTelegramChatId(ctx.chat.id);
      
      result = await trailService.showSellMode(
        progress!.id,
        Number(marketSellPageMatch[1]),
        Number(marketSellPageMatch[2])
      );
    } else if (marketExch1Match) {
      // Exchange step 1 - selected market item, show player inventory
      const user = await UserModel.findByTelegramId(ctx.from.id);
      const season = await SeasonModel.getCurrentSeason();
      const progress = await PlayerProgressModel.find(user!.id, season!.id);
      
      result = await trailService.showExchangeSelectPlayerItem(
        progress!.id,
        Number(marketExch1Match[1]),
        Number(marketExch1Match[2]),
        0
      );
    } else if (marketExch2Match) {
      // Execute exchange
      const marketItemIdx = Number(marketExch2Match[2]);
      const playerItemIdx = Number(marketExch2Match[3]);
      
      result = await gameService.resolveTrailMarketAction(
        ctx.from.id,
        ctx.chat.id,
        Number(marketExch2Match[1]),
        'exchange',
        `${marketItemIdx}_${playerItemIdx}` as any
      );
    } else if (marketExchPageMatch) {
      // Exchange pagination
      const user = await UserModel.findByTelegramId(ctx.from.id);
      const season = await SeasonModel.getCurrentSeason();
      const progress = await PlayerProgressModel.find(user!.id, season!.id);
      
      result = await trailService.showExchangeSelectPlayerItem(
        progress!.id,
        Number(marketExchPageMatch[1]),
        Number(marketExchPageMatch[2]),
        Number(marketExchPageMatch[3])
      );
    } else if (marketActionMatch) {
      // Old action format
      result = await gameService.resolveTrailMarketAction(
        ctx.from.id,
        ctx.chat.id,
        Number(marketActionMatch[1]),
        marketActionMatch[2] as any
      );
    }

    if (result) {
      await ctx.answerCallbackQuery(formatAlert(result.message));
      if (ctx.callbackQuery.message) {
        await ctx.editMessageText(markdownToTelegramHtml(result.message), {
          parse_mode: 'HTML',
          reply_markup: result.keyboard,
        });
      }
    }
  } catch (error: any) {
    console.error('Error in handleTrailCallback:', error);
    await ctx.answerCallbackQuery(formatAlert(error.message || '❌ Ошибка'));
  }
}

export async function handleStatus(ctx: Context) {
  if (!ctx.from || !ctx.chat) {
    return;
  }

  const isPrivateChat = ctx.chat.type === 'private';
  const result = await gameService.getPlayerStatus(ctx.from.id, ctx.chat.id, isPrivateChat);
  await ctx.reply(markdownToTelegramHtml(result.message), { 
    parse_mode: 'HTML',
    reply_markup: result.keyboard
  });
}

export async function handleInventory(ctx: Context) {
  if (!ctx.from || !ctx.chat) {
    return;
  }

  const inventory = await gameService.getInventory(ctx.from.id, ctx.chat.id);
  await ctx.reply(markdownToTelegramHtml(inventory), { parse_mode: 'HTML' });
}

export async function handleEquipCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const match = /^equip:(\d+)$/.exec(ctx.callbackQuery.data);
  if (!match) return;
  const message = await gameService.equipItem(ctx.from.id, Number(match[1]));
  await ctx.answerCallbackQuery(formatAlert(message));
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
    try {
      const result = await gameService.getEquipmentMenu(ctx.from.id, menu[1], Number(menu[2]));
      await ctx.answerCallbackQuery();
      if (ctx.callbackQuery.message) {
        // Check if message content changed before editing
        const currentText = ctx.callbackQuery.message.text || '';
        if (currentText !== result.message) {
          await ctx.editMessageText(result.message, {
            reply_markup: result.keyboard,
            parse_mode: 'Markdown',
          });
        }
      }
    } catch (error: any) {
      await ctx.answerCallbackQuery(formatAlert(error.message || '❌ Ошибка'));
    }
    return;
  }
  
  try {
    const result = await gameService.toggleEquipment(
      ctx.from.id,
      Number(item![1]),
      item![2]
    );
    await ctx.answerCallbackQuery(formatAlert(result));
    if (ctx.callbackQuery.message) {
      const refreshed = await gameService.getEquipmentMenu(ctx.from.id, item![2], Number(item![3]));
      await ctx.editMessageText(refreshed.message, {
        reply_markup: refreshed.keyboard,
        parse_mode: 'Markdown',
      });
    }
  } catch (error: any) {
    await ctx.answerCallbackQuery(formatAlert(error.message || '❌ Ошибка'));
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
    await ctx.answerCallbackQuery(formatAlert(message));
    await ctx.editMessageText(markdownToTelegramHtml(message), { parse_mode: 'HTML' });
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
  await ctx.answerCallbackQuery(formatAlert(message));
  await ctx.editMessageText(markdownToTelegramHtml(message), { parse_mode: 'HTML' });
}

export async function handleSacrificeCallbackWithPayment(
  ctx: Context,
  invoiceService: InvoiceService
) {
  if (!ctx.from || !ctx.chat || !ctx.callbackQuery?.data) return;
  const match = /^sacrifice:skip:(mobs|boss)(?::(\d+))?$/.exec(ctx.callbackQuery.data);
  if (!match) return;
  const command = `sacrifice_skip:${match[1]}${match[2] ? `:${match[2]}` : ''}`;
  const { keyboard } = await invoiceService.createSkipCooldownInvoice({
    telegramUserId: ctx.from.id,
    chatId: ctx.chat.id,
    command,
    amount: 5,
    title: 'Пропуск КД жертвоприношения',
    replyToMessageId: ctx.callbackQuery.message?.message_id,
  });
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
  await ctx.answerCallbackQuery(formatAlert(result));
  await ctx.editMessageText(markdownToTelegramHtml(result), { parse_mode: 'HTML' });
}

export async function handleUsePotion(ctx: Context) {
  if (!ctx.from || !ctx.chat) {
    return;
  }

  const menu = await gameService.getPotionMenu(ctx.from.id, ctx.chat.id);
  await ctx.reply(markdownToTelegramHtml(menu.message), {
    parse_mode: 'HTML',
    reply_markup: menu.keyboard,
  });
}

export async function handlePotionCallback(ctx: Context) {
  if (!ctx.from || !ctx.chat || !ctx.callbackQuery?.data) return;
  const match = /^potion:use:(\d+)$/.exec(ctx.callbackQuery.data);
  if (!match) return;

  const result = await gameService.usePotion(ctx.from.id, ctx.chat.id, Number(match[1]));
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(markdownToTelegramHtml(result.message), { parse_mode: 'HTML' });
}

/**
 * Handle status menu callbacks (market, inventory, equipment, slots).
 * Sub-menus replace the /status message in place; the "Статус" button opens it again.
 */
export async function handleStatusCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const data = ctx.callbackQuery.data;
  
  // Parse status menu callbacks
  const statusMatch = /^status:(market|inventory|equipment|slots|reset|pin|stats|back):(\d+)$/.exec(data);
  if (!statusMatch) return;
  
  const [, action, userId] = statusMatch;
  
  // Check authorization
  if (Number(userId) !== ctx.from.id) {
    await ctx.answerCallbackQuery('❌ Это не ваше меню!');
    return;
  }

  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    await ctx.answerCallbackQuery('❌ Чат недоступен.');
    return;
  }
  
  try {
    if (action === 'back') {
      const status = await gameService.getPlayerStatus(
        ctx.from.id,
        chatId,
        ctx.chat?.type === 'private'
      );
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(markdownToTelegramHtml(status.message), {
        reply_markup: status.keyboard,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    } else if (action === 'market') {
      const result = await gameService.getDailyMarket(ctx.from.id, 0);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(markdownToTelegramHtml(result.message), {
        reply_markup: result.keyboard,
        parse_mode: 'HTML',
      });
    } else if (action === 'inventory') {
      const inventory = await gameService.getInventory(ctx.from.id, chatId);
      const keyboard = new InlineKeyboard().text('📊 Статус', `status:back:${ctx.from.id}`);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(markdownToTelegramHtml(inventory), {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });
    } else if (action === 'equipment') {
      const result = await gameService.getEquipmentMenu(ctx.from.id);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(result.message, {
        reply_markup: result.keyboard,
        parse_mode: 'Markdown',
      });
    } else if (action === 'slots') {
      // Import slots handler dynamically to avoid circular dependencies
      try {
        const { handleSlotsButton } = await import('./slots');
        await ctx.answerCallbackQuery();
        console.log(`[SLOTS] Button clicked by user ${ctx.from.id}`);
        await handleSlotsButton(ctx);
      } catch (error: any) {
        console.error('[SLOTS] Error handling slots button:', error);
        await ctx.answerCallbackQuery(formatAlert(`❌ Ошибка: ${error.message}`));
      }
    } else if (action === 'reset') {
      const result = await gameService.getResetMenu(ctx.from.id);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(markdownToTelegramHtml(result.message), {
        reply_markup: result.keyboard,
        parse_mode: 'HTML',
      });
    } else if (action === 'pin') {
      const result = await gameService.getPinMenu(ctx.from.id);
      if (result.hasPins) {
        pendingPinSelections.set(ctx.from.id, { timestamp: Date.now() });
      }
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(markdownToTelegramHtml(result.message), {
        reply_markup: result.keyboard,
        parse_mode: 'HTML',
      });
    } else if (action === 'stats') {
      const stats = await seasonService.getSeasonStats(ctx.from.id);
      const keyboard = new InlineKeyboard().text('📊 Статус', `status:back:${ctx.from.id}`);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(markdownToTelegramHtml(stats), {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });
    }
  } catch (error: any) {
    await ctx.answerCallbackQuery(formatAlert(error.message || '❌ Ошибка'));
  }
}

/**
 * Handles a typed pin number while the pin menu is open.
 * Returns true when the message was consumed by the pin flow.
 */
export async function handlePinTextInput(ctx: Context): Promise<boolean> {
  if (!ctx.from || !ctx.message?.text) return false;

  const pending = pendingPinSelections.get(ctx.from.id);
  if (!pending) return false;

  if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
    pendingPinSelections.delete(ctx.from.id);
    return false;
  }

  // Only intercept plain numbers; anything else is left to other handlers.
  if (!/^\d+$/.test(ctx.message.text.trim())) return false;

  pendingPinSelections.delete(ctx.from.id);
  const result = await gameService.setPin(ctx.from.id, Number(ctx.message.text.trim()));
  await ctx.reply(markdownToTelegramHtml(result.message), { parse_mode: 'HTML' });
  return true;
}

/**
 * Handle /reset - asks for confirmation before wiping the player's progress.
 */
export async function handleReset(ctx: Context) {
  if (!ctx.from) return;

  try {
    const result = await gameService.getResetMenu(ctx.from.id);
    await ctx.reply(markdownToTelegramHtml(result.message), {
      reply_markup: result.keyboard,
      parse_mode: 'HTML',
    });
  } catch (error: any) {
    await ctx.reply(`❌ Ошибка: ${error.message || 'Неизвестная ошибка'}`);
  }
}

/**
 * Handle reset confirmation callbacks (confirm / cancel).
 */
export async function handleResetCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;

  const match = /^reset:(confirm|cancel):(\d+)$/.exec(ctx.callbackQuery.data);
  if (!match) return;

  const [, action, userId] = match;

  if (Number(userId) !== ctx.from.id) {
    await ctx.answerCallbackQuery('❌ Это не ваше меню!');
    return;
  }

  if (action === 'cancel') {
    await ctx.answerCallbackQuery('Отменено');
    await ctx.editMessageText('❌ Сброс отменён.', { parse_mode: 'HTML' }).catch(() => {});
    return;
  }

  try {
    const result = await gameService.resetPlayer(ctx.from.id);
    await ctx.answerCallbackQuery('Прогресс сброшен');
    await ctx.editMessageText(markdownToTelegramHtml(result.message), {
      reply_markup: result.keyboard,
      parse_mode: 'HTML',
    });
  } catch (error: any) {
    await ctx.answerCallbackQuery(formatAlert(error.message || '❌ Ошибка'));
  }
}

/**
 * Handle daily market callbacks (pagination, buy, sell, close)
 */
export async function handleMarketCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const data = ctx.callbackQuery.data;
  
  if (!data.startsWith('market:')) return;
  
  // Parse market callbacks
  const pageMatch = /^market:page:(\d+):(\d+)$/.exec(data);
  const buyMatch = /^market:buy:(\d+):(\d+)$/.exec(data);
  const sellPageMatch = /^market:sell:(\d+):(\d+)$/.exec(data);
  const sellItemMatch = /^market:sellitem:(\d+):(\d+):(\d+)$/.exec(data);
  const closeMatch = /^market:close:(\d+)$/.exec(data);
  
  if (!pageMatch && !buyMatch && !sellPageMatch && !sellItemMatch && !closeMatch) return;
  
  // Check authorization
  const userId = pageMatch?.[2] || buyMatch?.[2] || sellPageMatch?.[2] || sellItemMatch?.[3] || closeMatch?.[1];
  if (Number(userId) !== ctx.from.id) {
    await ctx.answerCallbackQuery('❌ Это не ваше меню!');
    return;
  }
  
  try {
    if (pageMatch) {
      // Pagination
      const page = Number(pageMatch[1]);
      const result = await gameService.getDailyMarket(ctx.from.id, page);
      await ctx.answerCallbackQuery();
      if (ctx.callbackQuery.message) {
        await ctx.editMessageText(markdownToTelegramHtml(result.message), {
          reply_markup: result.keyboard,
          parse_mode: 'HTML',
        });
      }
    } else if (buyMatch) {
      // Buy item
      const itemIndex = Number(buyMatch[1]);
      const result = await gameService.buyFromDailyMarket(ctx.from.id, itemIndex);
      
      if (result.success) {
        await ctx.answerCallbackQuery(formatAlert(result.message));
        // Refresh market to show updated gold
        const market = await gameService.getDailyMarket(ctx.from.id, 0);
        if (ctx.callbackQuery.message) {
          await ctx.editMessageText(markdownToTelegramHtml(market.message), {
            reply_markup: market.keyboard,
            parse_mode: 'HTML',
          });
        }
      } else {
        await ctx.answerCallbackQuery(formatAlert(result.message));
      }
    } else if (sellPageMatch) {
      // Open the sell view / change its page
      const page = Number(sellPageMatch[1]);
      const result = await gameService.getDailyMarketSellMenu(ctx.from.id, page);
      await ctx.answerCallbackQuery();
      if (ctx.callbackQuery.message) {
        await ctx.editMessageText(markdownToTelegramHtml(result.message), {
          reply_markup: result.keyboard,
          parse_mode: 'HTML',
        });
      }
    } else if (sellItemMatch) {
      // Sell one item and refresh the sell view
      const itemId = Number(sellItemMatch[1]);
      const page = Number(sellItemMatch[2]);
      const result = await gameService.sellFromDailyMarket(ctx.from.id, itemId);
      await ctx.answerCallbackQuery(formatAlert(result.message));
      const menu = await gameService.getDailyMarketSellMenu(ctx.from.id, page);
      if (ctx.callbackQuery.message) {
        await ctx.editMessageText(markdownToTelegramHtml(menu.message), {
          reply_markup: menu.keyboard,
          parse_mode: 'HTML',
        });
      }
    } else if (closeMatch) {
      // Close market
      await ctx.answerCallbackQuery();
      if (ctx.callbackQuery.message) {
        await ctx.editMessageText('🏪 Маркет закрыт. Возвращайтесь завтра!');
      }
    }
  } catch (error: any) {
    await ctx.answerCallbackQuery(formatAlert(error.message || '❌ Ошибка'));
  }
}
