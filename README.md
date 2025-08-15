# komunalka-bot v2

Telegraf + Express бот для погодження та пересилання скрінів орендарям.

## Нове в v2
- HTTP ендпоінт **POST /api/screenshot** — приймає зображення (base64 або dataURL) з веб‑додатку і надсилає його **власнику (APPROVER_ID)**. Далі бот показує кнопки куди відправити.

### Виклик
```
POST https://<твій-сервіс>.onrender.com/api/screenshot
Headers:
  Content-Type: application/json
  X-API-KEY: <API_KEY>        # необов'язково, але бажано
Body (JSON):
{
  "image": "<data:image/png;base64,....> або просто рядок base64",
  "caption": "необов'язково"
}
```

## Змінні середовища
- `BOT_TOKEN` — токен бота
- `APPROVER_ID` — chat_id власника (кому прилітає фото на погодження)
- `TENANTS_JSON` — масив орендарів `[{ "name":"...", "chatId":"..." }]`
- `WEBHOOK_URL` — URL вебхука Render + `/webhook`
- `API_KEY` — довільний секрет, який клієнт передає в заголовку `X-API-KEY` (опційно, для безпеки)
- `PORT` — автоматично підставляє Render

## Потік
1. Веб‑додаток робить `POST /api/screenshot` з PNG у base64.
2. Бот надсилає фото **APPROVER_ID**.
3. Власник натискає кнопку з назвою квартири → бот пересилає фото орендарю.
