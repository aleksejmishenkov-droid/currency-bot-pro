require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ КЭШ КУРСОВ ============
let fiatRates = {};
let cryptoRates = {};
let lastUpdate = 0;

// Маппинг symbol -> CoinGecko ID (для графиков крипты)
const CG_IDS = {
    BTC:'bitcoin', ETH:'ethereum', USDT:'tether', BNB:'binancecoin', SOL:'solana',
    USDC:'usd-coin', XRP:'ripple', ADA:'cardano', DOGE:'dogecoin', AVAX:'avalanche-2',
    DOT:'polkadot', MATIC:'matic-network', LINK:'chainlink', TRX:'tron', SHIB:'shiba-inu',
    LTC:'litecoin', UNI:'uniswap', ATOM:'cosmos', XLM:'stellar', BCH:'bitcoin-cash',
    FIL:'filecoin', AAVE:'aave', NEAR:'near', APT:'aptos', ARB:'arbitrum', OP:'optimism',
    FTM:'fantom', ALGO:'algorand', VET:'vechain', HBAR:'hedera-hashgraph', THETA:'theta-token',
    EGLD:'elrond-erd-2', XTZ:'tezos', SAND:'the-sandbox', MANA:'decentraland',
    AXS:'axie-infinity', GRT:'the-graph', CRV:'curve-dao-token', SUSHI:'sushi',
    COMP:'compound-governance-token', MKR:'maker', SNX:'havven', YFI:'yearn-finance',
    ENJ:'enjincoin', CHZ:'chiliz', GALA:'gala', IMX:'immutable-x', APE:'apecoin',
    LDO:'lido-dao', TON:'the-open-network', NOT:'notcoin', KAS:'kaspa', ICP:'internet-computer',
    STX:'blockstack', RUNE:'thorchain', DYDX:'dydx', BLUR:'blur', GMX:'gmx',
    PENDLE:'pendle', JUP:'jupiter-exchange-solana', PYTH:'pyth-network', W:'wormhole',
    STRK:'starknet', MANTA:'manta-network', DYM:'dymension', ONDO:'ondo-finance',
    ORDI:'ordi', PEPE:'pepe', FLOKI:'floki', BONK:'bonk', WIF:'dogwifcoin'
};

async function updateRates() {
    try {
        const fiatRes = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const fiatData = await fiatRes.json();
        fiatRates = fiatData.rates;

        const cryptoRes = await fetch(
            'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false'
        );
        const cryptoData = await cryptoRes.json();
        cryptoData.forEach(c => {
            cryptoRates[c.symbol.toLowerCase()] = c.current_price;
        });

        lastUpdate = Date.now();
        console.log('✅ Курсы обновлены:', new Date().toLocaleTimeString());

        // Проверяем алерты
        checkAlerts();
    } catch (e) {
        console.error('❌ Ошибка обновления:', e.message);
    }
}

// ============ АЛЕРТЫ ============
let alerts = [];
const ALERTS_FILE = path.join(__dirname, 'alerts.json');

function loadAlerts() {
    try {
        if (fs.existsSync(ALERTS_FILE)) {
            alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
        }
    } catch (e) { alerts = []; }
}

function saveAlerts() {
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
}

loadAlerts();

function checkAlerts() {
    const triggered = [];
    alerts = alerts.filter(a => {
        const price = cryptoRates[a.code.toLowerCase()] || (fiatRates[a.code] ? 1 / fiatRates[a.code] : null);
        if (price === null) return true;

        const hit = (a.condition === 'above' && price >= a.targetPrice) ||
                    (a.condition === 'below' && price <= a.targetPrice);
        if (hit) {
            triggered.push({ alert: a, price });
            return false;
        }
        return true;
    });

    if (triggered.length > 0) saveAlerts();

    triggered.forEach(({ alert, price }) => {
        const emoji = alert.condition === 'above' ? '📈' : '📉';
        const word = alert.condition === 'above' ? 'превысил' : 'опустился ниже';
        bot.telegram.sendMessage(alert.chatId,
            `${emoji} <b>Уведомление о курсе!</b>\n\n` +
            `<b>${alert.code}</b> ${word} целевого значения.\n` +
            `🎯 Цель: ${alert.targetPrice}\n` +
            `💰 Текущая цена: <b>${price.toFixed(4)}</b>`,
            { parse_mode: 'HTML' }
        ).catch(e => console.error('Alert send error:', e.message));
    });
}

// ============ API ЭНДПОИНТЫ ============
app.get('/api/rates', (req, res) => {
    res.json({ fiat: fiatRates, crypto: cryptoRates, updated: lastUpdate });
});

app.get('/api/convert', (req, res) => {
    const { from, to, amount } = req.query;
    if (!from || !to || !amount) return res.status(400).json({ error: 'Missing params' });
    try {
        const amt = parseFloat(amount);
        let usdValue;
        if (fiatRates[from.toUpperCase()]) usdValue = amt / fiatRates[from.toUpperCase()];
        else if (cryptoRates[from.toLowerCase()]) usdValue = amt * cryptoRates[from.toLowerCase()];
        else return res.status(404).json({ error: 'Unknown currency' });

        let result;
        if (fiatRates[to.toUpperCase()]) result = usdValue * fiatRates[to.toUpperCase()];
        else if (cryptoRates[to.toLowerCase()]) result = usdValue / cryptoRates[to.toLowerCase()];
        else return res.status(404).json({ error: 'Unknown target' });

        res.json({ result: result.toFixed(8), rate: result / amt });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// График для крипты (CoinGecko)
app.get('/api/chart/crypto/:code', async (req, res) => {
    const code = req.params.code.toLowerCase();
    const days = parseInt(req.query.days) || 7;
    const id = CG_IDS[code.toUpperCase()];
    if (!id) return res.status(404).json({ error: 'No CoinGecko ID for ' + code });
    try {
        const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`);
        const data = await r.json();
        res.json({ prices: data.prices.map(p => ({ t: p[0], v: p[1] })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// График для фиата (Frankfurter — история ECB)
app.get('/api/chart/fiat/:code', async (req, res) => {
    const code = req.params.code.toUpperCase();
    const days = parseInt(req.query.days) || 7;
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    const fmt = d => d.toISOString().slice(0, 10);
    try {
        const url = `https://api.frankfurter.app/${fmt(start)}..${fmt(end)}?from=USD&to=${code}`;
        const r = await fetch(url);
        const data = await r.json();
        const prices = Object.entries(data.rates).map(([date, rates]) => ({
            t: new Date(date).getTime(),
            v: 1 / rates[code]
        }));
        res.json({ prices });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Алерты API
app.post('/api/alerts', (req, res) => {
    const { userId, chatId, code, condition, targetPrice } = req.body;
    if (!userId || !chatId || !code || !condition || !targetPrice) {
        return res.status(400).json({ error: 'Missing fields' });
    }
    const alert = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        userId, chatId, code: code.toUpperCase(),
        condition, targetPrice: parseFloat(targetPrice),
        createdAt: Date.now()
    };
    alerts.push(alert);
    saveAlerts();
    res.json({ ok: true, alert });
});

app.get('/api/alerts/:userId', (req, res) => {
    const userAlerts = alerts.filter(a => a.userId == req.params.userId);
    res.json(userAlerts);
});

app.delete('/api/alerts/:id', (req, res) => {
    alerts = alerts.filter(a => a.id !== req.params.id);
    saveAlerts();
    res.json({ ok: true });
});

// ============ КОМАНДЫ БОТА ============
bot.start((ctx) => {
    ctx.reply(
        `👋 <b>Привет, ${ctx.from.first_name}!</b>\n\n` +
        `💱 Я — твой персональный конвертер валют и криптовалют.\n` +
        `📈 Актуальные курсы + графики динамики.\n` +
        `🔔 Уведомления о достижении курса.\n` +
        `💼 Мультивалютный портфель.\n` +
        `🌍 159 валют мира + 100 криптовалют.\n\n` +
        `Выбери действие:`,
        {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "💱 Открыть конвертер", web_app: { url: process.env.APP_URL } }],
                    [
                        { text: "📈 График BTC", callback_data: 'chart_btc' },
                        { text: "💼 Портфель", callback_data: 'portfolio' }
                    ],
                    [
                        { text: "🔔 Мои алерты", callback_data: 'my_alerts' },
                        { text: "ℹ️ Помощь", callback_data: 'help' }
                    ]
                ]
            }
        }
    );
});

bot.help((ctx) => {
    ctx.reply(
        `📖 <b>Команды бота:</b>\n\n` +
        `/start — Запустить бота\n` +
        `/convert <сумма> <из> <в> — Быстрая конвертация\n` +
        `   Пример: <code>/convert 100 USD RUB</code>\n\n` +
        `/rates — Курсы основных валют\n` +
        `/crypto — Топ-10 криптовалют\n` +
        `/chart <код> — График (например: <code>/chart BTC</code>)\n` +
        `/alert <код> <above|below> <цена> — Уведомление\n` +
        `   Пример: <code>/alert BTC above 100000</code>\n` +
        `/myalerts — Список активных уведомлений\n\n` +
        `/portfolio — Управление портфелем\n` +
        `/favorites — Избранные пары\n` +
        `/history — История конвертаций\n` +
        `/news — Новости рынка\n` +
        `/settings — Настройки\n` +
        `/help — Эта справка`,
        { parse_mode: 'HTML' }
    );
});

bot.command('convert', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length !== 3) return ctx.reply('❗ Формат: /convert <сумма> <из> <в>');
    const [amount, from, to] = args;
    try {
        const res = await fetch(`${process.env.APP_URL}/api/convert?from=${from}&to=${to}&amount=${amount}`);
        const data = await res.json();
        if (data.error) return ctx.reply('❌ ' + data.error);
        ctx.reply(
            `💱 ${amount} ${from.toUpperCase()} = <b>${parseFloat(data.result).toFixed(4)} ${to.toUpperCase()}</b>\n` +
            `📊 Курс: 1 ${from.toUpperCase()} = ${data.rate.toFixed(6)} ${to.toUpperCase()}`,
            { parse_mode: 'HTML' }
        );
    } catch (e) { ctx.reply('❌ Ошибка'); }
});

bot.command('rates', (ctx) => {
    const main = ['RUB','EUR','GBP','JPY','CNY','KZT','UAH','BYN'];
    let msg = '💵 <b>Курсы валют (к USD):</b>\n\n';
    main.forEach(c => { if (fiatRates[c]) msg += `1 USD = ${fiatRates[c].toFixed(2)} ${c}\n`; });
    ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('crypto', (ctx) => {
    const top = Object.entries(cryptoRates).slice(0, 10);
    let msg = '🪙 <b>Топ-10 криптовалют (USD):</b>\n\n';
    top.forEach(([sym, price]) => {
        msg += `<b>${sym.toUpperCase()}</b>: $${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`;
    });
    ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('chart', async (ctx) => {
    const code = ctx.message.text.split(' ')[1]?.toUpperCase();
    if (!code) return ctx.reply('❗ Формат: /chart BTC');
    ctx.reply(`📈 Открываю график ${code}...`, {
        reply_markup: {
            inline_keyboard: [[{ text: `Открыть график ${code}`, web_app: { url: `${process.env.APP_URL}?tab=chart&code=${code}` } }]]
        }
    });
});

bot.command('alert', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length !== 3 || !['above','below'].includes(args[1])) {
        return ctx.reply('❗ Формат: /alert <код> <above|below> <цена>\nПример: <code>/alert BTC above 100000</code>', { parse_mode: 'HTML' });
    }
    const [code, condition, price] = args;
    alerts.push({
        id: Date.now() + '-' + Math.random().toString(36).slice(2,8),
        userId: ctx.from.id,
        chatId: ctx.chat.id,
        code: code.toUpperCase(),
        condition,
        targetPrice: parseFloat(price),
        createdAt: Date.now()
    });
    saveAlerts();
    ctx.reply(`🔔 Уведомление создано!\n\nЯ сообщу тебе, когда <b>${code.toUpperCase()}</b> ${condition === 'above' ? 'превысит' : 'опустится ниже'} <b>${price}</b>.`, { parse_mode: 'HTML' });
});

bot.command('myalerts', (ctx) => {
    const userAlerts = alerts.filter(a => a.userId == ctx.from.id);
    if (userAlerts.length === 0) return ctx.reply('🔕 У тебя нет активных уведомлений.\n\nСоздай: /alert BTC above 100000');
    let msg = '🔔 <b>Твои уведомления:</b>\n\n';
    userAlerts.forEach((a, i) => {
        const emoji = a.condition === 'above' ? '📈' : '📉';
        msg += `${i+1}. ${emoji} <b>${a.code}</b> ${a.condition === 'above' ? '>' : '<'} ${a.targetPrice}\n`;
    });
    ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('portfolio', (ctx) => {
    ctx.reply('💼 <b>Мультивалютный портфель</b>\n\nУправляй портфелем в Mini App:', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: "Открыть портфель", web_app: { url: `${process.env.APP_URL}?tab=portfolio` } }]]
        }
    });
});

bot.command('favorites', (ctx) => {
    ctx.reply('⭐ Избранные пары — в Mini App (вкладка "Избранное").');
});

bot.command('history', (ctx) => {
    ctx.reply('📜 История конвертаций — в Mini App (вкладка "История").');
});

bot.command('news', (ctx) => {
    ctx.reply(
        '📰 <b>Новости рынка:</b>\n\n' +
        '• Bitcoin обновил исторический максимум\n' +
        '• ФРС сохранила ставку без изменений\n' +
        '• Ethereum готовится к крупному обновлению\n\n' +
        '🔗 Полный обзор — в Mini App',
        { parse_mode: 'HTML' }
    );
});

bot.command('settings', (ctx) => {
    ctx.reply('⚙️ <b>Настройки:</b>', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎨 Тема", callback_data: 'theme' }],
                [{ text: "🌐 Язык", callback_data: 'lang' }],
                [{ text: "🔔 Уведомления", callback_data: 'alerts' }]
            ]
        }
    });
});

// Callback-кнопки
bot.action('chart_btc', (ctx) => ctx.answerCbQuery().then(() => {
    ctx.reply('📈 График BTC:', { reply_markup: { inline_keyboard: [[{ text: "Открыть", web_app: { url: `${process.env.APP_URL}?tab=chart&code=BTC` } }]] } });
}));
bot.action('portfolio', (ctx) => ctx.answerCbQuery().then(() => {
    ctx.reply('💼 Портфель:', { reply_markup: { inline_keyboard: [[{ text: "Открыть", web_app: { url: `${process.env.APP_URL}?tab=portfolio` } }]] } });
}));
bot.action('my_alerts', (ctx) => ctx.answerCbQuery().then(() => bot.command('myalerts')({ message: ctx.update.callback_query.message, from: ctx.from, reply: ctx.reply.bind(ctx) })));
bot.action('help', (ctx) => ctx.answerCbQuery().then(() => bot.help({ reply: ctx.reply.bind(ctx) })));

// ============ ЗАПУСК ============
updateRates();
setInterval(updateRates, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));