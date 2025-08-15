// komunalka-bot v2 (Telegraf + Express + HTTP endpoint)
// Purpose: Approve & forward screenshots to tenants
// Adds POST /api/screenshot to receive base64/dataURL image from the web app
// and send it to the APPROVER_ID, then the approver chooses a tenant via buttons.

const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const {
  BOT_TOKEN,
  APPROVER_ID,
  TENANTS_JSON,
  WEBHOOK_URL,
  WEBHOOK_PATH = '/webhook',
  API_KEY,
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
app.use(express.json({ limit: '12mb' })); // for /api/screenshot
const bot = new Telegraf(BOT_TOKEN);

// Health endpoints
app.get('/', (_req, res) => res.type('text').send('komunalka-bot v2 is running.'));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// --- HTTP API: receive screenshot from web app ---
app.post('/api/screenshot', async (req, res) => {
  try {
    if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    let { image, caption = '' } = req.body || {};
    if (!image) {
      return res.status(400).json({ ok: false, error: 'image required (base64 or dataURL)' });
    }
    // image may be dataURL ('data:image/png;base64,...') or pure base64
    if (typeof image !== 'string') {
      return res.status(400).json({ ok: false, error: 'image must be string' });
    }
    const base64 = image.startsWith('data:') ? image.split(',')[1] : image;
    const buf = Buffer.from(base64, 'base64');
    if (!buf.length) {
      return res.status(400).json({ ok: false, error: 'invalid base64' });
    }

    // Send to approver; bot logic will ask where to forward
    await bot.telegram.sendPhoto(APPROVER_ID, { source: buf }, { caption });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/screenshot error', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// --- Bot commands ---
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

  const buttons = tenants.map(t => Markup.button.callback(t.name, `send|${t.chatId}`));
  const rows = [];
  while (buttons.length) rows.push(buttons.splice(0, 2)); // 2 per row

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
