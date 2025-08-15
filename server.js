// komunalka-bot server (Telegraf + Express)
// Purpose: Approve & forward screenshots to tenants

const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const {
  BOT_TOKEN,
  APPROVER_ID,
  TENANTS_JSON,
  WEBHOOK_URL,
  WEBHOOK_PATH = '/webhook',
  PORT = 10000
} = process.env;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required');
  process.exit(1);
}
if (!APPROVER_ID) {
  console.error('APPROVER_ID is required (your Telegram numeric user ID)');
  process.exit(1);
}

let tenants = [];
try {
  tenants = JSON.parse(TENANTS_JSON || '[]');
  if (!Array.isArray(tenants)) tenants = [];
} catch (e) {
  tenants = [];
}

const app = express();
const bot = new Telegraf(BOT_TOKEN);

// Health & info
app.get('/', (_req, res) => res.type('text').send('komunalka-bot is running.'));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Commands
bot.start((ctx) => ctx.reply('Вітаю! Надішліть фото розрахунку.\n/cfg — переглянути налаштування\n/id — показати ваш chat_id'));
bot.command('id', (ctx) => ctx.reply(`Ваш chat_id: ${ctx.from.id}`));
bot.command('cfg', (ctx) => {
  const names = tenants.map(t => `• ${t.name}: ${t.chatId}`).join('\n') || '— не налаштовано —';
  ctx.reply(`APPROVER_ID: ${APPROVER_ID}\nОрендарі:\n${names}`);
});

// When approver sends a photo — ask where to forward
bot.on('photo', async (ctx) => {
  const fromId = String(ctx.from.id);
  const isApprover = fromId === String(APPROVER_ID);
  if (!isApprover) {
    return ctx.reply('Дякую! Очікуйте підтвердження власника.');
  }

  // Build keyboard with tenants (up to 8 buttons per row)
  const buttons = tenants.map(t => Markup.button.callback(t.name, `send|${t.chatId}`));
  const rows = [];
  while (buttons.length) rows.push(buttons.splice(0, 2)); // 2 per row for readability

  await ctx.reply(
    'Куди відправити?',
    {
      reply_to_message_id: ctx.message.message_id,
      ...Markup.inlineKeyboard([
        ...rows,
        [Markup.button.callback('❌ Відхилити', 'reject')]
      ])
    }
  );
});

bot.on('message', (ctx) => {
  if (ctx.message && ctx.message.document) {
    // If user sent as file instead of photo, we still allow forwarding after /approve
    ctx.reply('Отримав файл. Для фото краще надсилати як "Photo", не як "File".');
  }
});

// Handle button clicks
bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data || '';
    if (data === 'reject') {
      await ctx.answerCbQuery('Скасовано.');
      await ctx.editMessageText('Відправку скасовано.');
      return;
    }
    if (data.startsWith('send|')) {
      const targetChatId = data.split('|')[1];
      const replied = ctx.callbackQuery.message && ctx.callbackQuery.message.reply_to_message;
      if (!replied) {
        await ctx.answerCbQuery('Немає фото для відправки.', { show_alert: true });
        return;
      }
      const sourceMessageId = replied.message_id;
      const sourceChatId = APPROVER_ID;

      await ctx.telegram.copyMessage(targetChatId, sourceChatId, sourceMessageId);
      await ctx.answerCbQuery('Відправлено.');
      await ctx.editMessageText('✅ Відправлено орендарю.');
    }
  } catch (e) {
    console.error('callback error', e);
    try { await ctx.answerCbQuery('Помилка. Деталі в логах.'); } catch {}
  }
});

// Webhook
if (WEBHOOK_URL) {
  bot.telegram.setWebhook(WEBHOOK_URL).then(() => {
    console.log('Webhook set to', WEBHOOK_URL);
  }).catch(err => {
    console.error('Failed to set webhook:', err);
  });
  app.use(bot.webhookCallback(WEBHOOK_PATH));
} else {
  console.log('WEBHOOK_URL is not set. The service expects webhook mode.');
  app.use(bot.webhookCallback(WEBHOOK_PATH));
}

app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
