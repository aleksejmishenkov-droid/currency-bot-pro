const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// ============ СОСТОЯНИЕ ============
let allCurrencies = [];
let allCrypto = [];
let rates = { fiat: {}, crypto: {} };
let currentSelector = null;
let currentType = 'fiat';
let selectedFrom = { code: 'USD', name: 'Доллар США', icon: '🇺🇸', type: 'fiat' };
let selectedTo = { code: 'RUB', name: 'Российский рубль', icon: '🇷🇺', type: 'fiat' };
let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
let history = JSON.parse(localStorage.getItem('history') || '[]');
let portfolio = JSON.parse(localStorage.getItem('portfolio') || '[]');
let portfolioBase = localStorage.getItem('portfolioBase') || 'USD';

// Для графиков
let priceChart = null;
let portfolioChart = null;
let chartCurrency = { code: 'BTC', name: 'Bitcoin', icon: '₿', color: '#F7931A', type: 'crypto' };
let chartDays = 7;

// Для алертов
let alertCondition = 'above';
let assetSelectorContext = null;

// ============ ЗАГРУЗКА ============
async function loadData() {
    const [currRes, cryptoRes, ratesRes] = await Promise.all([
        fetch('currencies.json'),
        fetch('crypto.json'),
        fetch('/api/rates')
    ]);
    allCurrencies = await currRes.json();
    allCrypto = await cryptoRes.json();
    rates = await ratesRes.json();
    convert();
    renderRates();
    renderFavorites();
    renderPortfolio();
    loadAlerts();
}

// ============ ПОИСК ============
function filterCurrencies(query, type) {
    const q = query.toLowerCase().trim();
    const list = type === 'fiat' ? allCurrencies : allCrypto;
    if (!q) return list;
    return list.filter(c =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.country && c.country.toLowerCase().includes(q)) ||
        (c.blockchain && c.blockchain.toLowerCase().includes(q))
    );
}

// ============ МОДАЛКА ВАЛЮТ ============
const currencyModal = document.getElementById('currencyModal');
const currencyList = document.getElementById('currencyList');
const currencySearch = document.getElementById('currencySearch');

function openCurrencyModal(context, initialType) {
    currentSelector = context;
    currentType = initialType || 'fiat';
    updateTypeButtons();
    renderCurrencyList('');
    currencySearch.value = '';
    currencyModal.classList.add('active');
    setTimeout(() => currencySearch.focus(), 100);
}

function closeCurrencyModal() { currencyModal.classList.remove('active'); }

document.getElementById('closeModal').onclick = closeCurrencyModal;
currencyModal.onclick = (e) => { if (e.target === currencyModal) closeCurrencyModal(); };

document.getElementById('fromBtn').onclick = () => openCurrencyModal('from', selectedFrom.type);
document.getElementById('toBtn').onclick = () => openCurrencyModal('to', selectedTo.type);
document.getElementById('chartCurrencyBtn').onclick = () => openCurrencyModal('chart', chartCurrency.type);
document.getElementById('assetCurrencyBtn').onclick = () => openCurrencyModal('asset', 'fiat');

currencySearch.addEventListener('input', (e) => renderCurrencyList(e.target.value));

document.querySelectorAll('.type-btn').forEach(btn => {
    btn.onclick = () => {
        currentType = btn.dataset.type;
        updateTypeButtons();
        renderCurrencyList(currencySearch.value);
    };
});

function updateTypeButtons() {
    document.querySelectorAll('.type-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === currentType);
    });
}

function renderCurrencyList(query) {
    const filtered = filterCurrencies(query, currentType);
    currencyList.innerHTML = filtered.map(c => {
        const icon = currentType === 'fiat'
            ? `<div class="icon">${c.flag}</div>`
            : `<div class="crypto-icon" style="background:${c.color}">${c.icon}</div>`;
        const subtitle = currentType === 'fiat'
            ? `<span class="country">${c.country}</span>`
            : `<span class="country">${c.blockchain}</span>`;
        return `
            <div class="currency-item" data-code="${c.code}" data-type="${currentType}">
                ${icon}
                <div class="info">
                    <span class="code">${c.code}</span>
                    <span class="name">${c.name}</span>
                    ${subtitle}
                </div>
            </div>
        `;
    }).join('');

    currencyList.querySelectorAll('.currency-item').forEach(item => {
        item.onclick = () => selectCurrency(item.dataset.code, item.dataset.type);
    });
}

function selectCurrency(code, type) {
    const list = type === 'fiat' ? allCurrencies : allCrypto;
    const c = list.find(x => x.code === code);
    if (!c) return;
    const data = {
        code: c.code,
        name: c.name,
        icon: type === 'fiat' ? c.flag : c.icon,
        color: c.color,
        country: c.country,
        blockchain: c.blockchain,
        type: type
    };

    if (currentSelector === 'from') { selectedFrom = data; updateSelectorUI('from', data); }
    else if (currentSelector === 'to') { selectedTo = data; updateSelectorUI('to', data); }
    else if (currentSelector === 'chart') { chartCurrency = data; updateChartCurrencyUI(); loadChart(); }
    else if (currentSelector === 'asset') {
        window._selectedAsset = data;
        updateAssetCurrencyUI(data);
    }

    closeCurrencyModal();
    if (currentSelector === 'from' || currentSelector === 'to') convert();
}

function updateSelectorUI(prefix, data) {
    const iconEl = document.getElementById(`${prefix}Icon`);
    const codeEl = document.getElementById(`${prefix}Code`);
    const nameEl = document.getElementById(`${prefix}Name`);
    if (data.type === 'crypto') {
        iconEl.className = 'currency-icon crypto-icon';
        iconEl.style.background = data.color;
        iconEl.style.color = 'white';
    } else {
        iconEl.className = 'currency-icon';
        iconEl.style.background = '';
        iconEl.style.color = '';
    }
    iconEl.textContent = data.icon;
    codeEl.textContent = data.code;
    nameEl.textContent = data.name;
}

function updateChartCurrencyUI() {
    const iconEl = document.getElementById('chartIcon');
    if (chartCurrency.type === 'crypto') {
        iconEl.className = 'currency-icon crypto-icon';
        iconEl.style.background = chartCurrency.color;
        iconEl.style.color = 'white';
    } else {
        iconEl.className = 'currency-icon';
        iconEl.style.background = '';
    }
    iconEl.textContent = chartCurrency.icon;
    document.getElementById('chartCode').textContent = chartCurrency.code;
    document.getElementById('chartName').textContent = chartCurrency.name;
}

function updateAssetCurrencyUI(data) {
    const iconEl = document.getElementById('assetIcon');
    if (data.type === 'crypto') {
        iconEl.className = 'currency-icon crypto-icon';
        iconEl.style.background = data.color;
        iconEl.style.color = 'white';
    } else {
        iconEl.className = 'currency-icon';
        iconEl.style.background = '';
    }
    iconEl.textContent = data.icon;
    document.getElementById('assetCode').textContent = data.code;
    document.getElementById('assetName').textContent = data.name;
}

// ============ КОНВЕРТАЦИЯ ============
async function convert() {
    const amount = parseFloat(document.getElementById('amount').value) || 0;
    if (amount <= 0) { document.getElementById('result').textContent = '—'; return; }
    try {
        const res = await fetch(`/api/convert?from=${selectedFrom.code}&to=${selectedTo.code}&amount=${amount}`);
        const data = await res.json();
        if (data.error) { document.getElementById('result').textContent = 'Ошибка'; return; }
        const result = parseFloat(data.result);
        document.getElementById('result').textContent =
            `${result.toLocaleString('ru-RU', { maximumFractionDigits: 8 })} ${selectedTo.code}`;
        document.getElementById('rateInfo').textContent =
            `1 ${selectedFrom.code} = ${parseFloat(data.rate).toLocaleString('ru-RU', { maximumFractionDigits: 8 })} ${selectedTo.code}`;
        addToHistory(amount, selectedFrom, result, selectedTo);
    } catch (e) { document.getElementById('result').textContent = 'Ошибка сети'; }
}

document.getElementById('amount').addEventListener('input', convert);

document.getElementById('swapBtn').onclick = () => {
    [selectedFrom, selectedTo] = [selectedTo, selectedFrom];
    updateSelectorUI('from', selectedFrom);
    updateSelectorUI('to', selectedTo);
    convert();
};

// ============ ВКЛАДКИ ============
document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const tabName = tab.dataset.tab;
        document.getElementById(tabName).classList.add('active');
        if (tabName === 'rates') renderRates();
        if (tabName === 'chart') loadChart();
        if (tabName === 'portfolio') renderPortfolio();
        if (tabName === 'favorites') renderFavorites();
        if (tabName === 'alerts') loadAlerts();
    };
});

// Обработка URL-параметров (?tab=chart&code=BTC)
const urlParams = new URLSearchParams(window.location.search);
const initTab = urlParams.get('tab');
const initCode = urlParams.get('code');
if (initTab) {
    setTimeout(() => {
        const tabBtn = document.querySelector(`[data-tab="${initTab}"]`);
        if (tabBtn) tabBtn.click();
        if (initCode && initTab === 'chart') {
            const c = allCrypto.find(x => x.code === initCode) || allCurrencies.find(x => x.code === initCode);
            if (c) {
                chartCurrency = {
                    code: c.code, name: c.name,
                    icon: c.flag || c.icon,
                    color: c.color,
                    type: allCrypto.find(x => x.code === initCode) ? 'crypto' : 'fiat'
                };
                updateChartCurrencyUI();
                loadChart();
            }
        }
    }, 500);
}

// ============ КУРСЫ ============
function renderRates(query = '') {
    const list = document.getElementById('ratesList');
    const q = query.toLowerCase();
    const fiatItems = allCurrencies.filter(c =>
        rates.fiat[c.code] && (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q))
    ).slice(0, 50).map(c => ({
        icon: c.flag, code: c.code, name: c.name,
        price: `₽${((1 / rates.fiat[c.code]) * rates.fiat.RUB).toFixed(2)}`,
        type: 'fiat'
    }));
    const cryptoItems = allCrypto.filter(c =>
        rates.crypto[c.code.toLowerCase()] && (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    ).slice(0, 50).map(c => ({
        icon: `<div class="crypto-icon" style="background:${c.color}">${c.icon}</div>`,
        code: c.code, name: c.name,
        price: `$${rates.crypto[c.code.toLowerCase()].toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        type: 'crypto'
    }));
    const all = [...cryptoItems, ...fiatItems];
    list.innerHTML = all.map(i => `
        <div class="rate-item" data-code="${i.code}" data-type="${i.type}">
            <div class="icon">${i.icon}</div>
            <div class="info">
                <div class="code">${i.code}</div>
                <div class="name">${i.name}</div>
            </div>
            <div class="price">${i.price}</div>
        </div>
    `).join('');
    list.querySelectorAll('.rate-item').forEach(item => {
        item.onclick = () => {
            const code = item.dataset.code;
            const type = item.dataset.type;
            const c = (type === 'fiat' ? allCurrencies : allCrypto).find(x => x.code === code);
            chartCurrency = {
                code: c.code, name: c.name,
                icon: type === 'fiat' ? c.flag : c.icon,
                color: c.color, type
            };
            updateChartCurrencyUI();
            document.querySelector('[data-tab="chart"]').click();
        };
    });
}
document.getElementById('ratesSearch').addEventListener('input', (e) => renderRates(e.target.value));

// ============ ГРАФИКИ ============
async function loadChart() {
    try {
        const endpoint = chartCurrency.type === 'crypto'
            ? `/api/chart/crypto/${chartCurrency.code}?days=${chartDays}`
            : `/api/chart/fiat/${chartCurrency.code}?days=${chartDays}`;
        const res = await fetch(endpoint);
        const data = await res.json();
        if (data.error || !data.prices || data.prices.length === 0) {
            document.getElementById('chartPrice').textContent = 'Нет данных';
            return;
        }
        renderPriceChart(data.prices);
    } catch (e) {
        document.getElementById('chartPrice').textContent = 'Ошибка загрузки';
    }
}

function renderPriceChart(prices) {
    const labels = prices.map(p => new Date(p.t));
    const values = prices.map(p => p.v);
    const first = values[0], last = values[values.length - 1];
    const change = ((last - first) / first) * 100;
    const isUp = change >= 0;

    document.getElementById('chartPrice').textContent =
        '$' + last.toLocaleString('en-US', { maximumFractionDigits: last < 1 ? 6 : 2 });
    const changeEl = document.getElementById('chartChange');
    changeEl.textContent = `${isUp ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}% за период`;
    changeEl.className = 'chart-change ' + (isUp ? 'up' : 'down');

    const ctx = document.getElementById('priceChart').getContext('2d');
    if (priceChart) priceChart.destroy();

    const gradient = ctx.createLinearGradient(0, 0, 0, 250);
    gradient.addColorStop(0, isUp ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');

    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: values,
                borderColor: isUp ? '#10b981' : '#ef4444',
                backgroundColor: gradient,
                borderWidth: 2.5,
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: isUp ? '#10b981' : '#ef4444'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    padding: 10,
                    titleFont: { size: 12 },
                    bodyFont: { size: 14, weight: 'bold' },
                    callbacks: {
                        title: (items) => new Date(items[0].parsed.x).toLocaleDateString('ru-RU'),
                        label: (item) => '$' + item.parsed.y.toLocaleString('en-US', { maximumFractionDigits: 4 })
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: chartDays <= 7 ? 'day' : chartDays <= 90 ? 'week' : 'month' },
                    grid: { display: false },
                    ticks: { color: '#999', maxTicksLimit: 6, font: { size: 11 } }
                },
                y: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: {
                        color: '#999',
                        font: { size: 11 },
                        callback: v => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
                    }
                }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    });
}

document.querySelectorAll('.period-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        chartDays = parseInt(btn.dataset.days);
        loadChart();
    };
});

// Кнопка "График" в конвертере
document.getElementById('chartBtn').onclick = () => {
    chartCurrency = { ...selectedFrom };
    updateChartCurrencyUI();
    document.querySelector('[data-tab="chart"]').click();
};

// ============ ПОРТФЕЛЬ ============
const assetModal = document.getElementById('assetModal');
document.getElementById('addAssetBtn').onclick = () => {
    window._selectedAsset = { code: 'USD', name: 'Доллар США', icon: '🇺🇸', type: 'fiat' };
    updateAssetCurrencyUI(window._selectedAsset);
    document.getElementById('assetAmount').value = '';
    assetModal.classList.add('active');
};
document.getElementById('closeAssetModal').onclick = () => assetModal.classList.remove('active');
assetModal.onclick = (e) => { if (e.target === assetModal) assetModal.classList.remove('active'); };

document.getElementById('saveAssetBtn').onclick = () => {
    const amount = parseFloat(document.getElementById('assetAmount').value);
    if (!amount || amount <= 0) {
        tg.showPopup({ title: 'Ошибка', message: 'Введите количество', buttons: [{ type: 'ok' }] });
        return;
    }
    portfolio.push({
        id: Date.now(),
        code: window._selectedAsset.code,
        name: window._selectedAsset.name,
        icon: window._selectedAsset.icon,
        color: window._selectedAsset.color,
        type: window._selectedAsset.type,
        amount
    });
    localStorage.setItem('portfolio', JSON.stringify(portfolio));
    assetModal.classList.remove('active');
    renderPortfolio();
    tg.HapticFeedback.notificationOccurred('success');
};

document.getElementById('portfolioBase').value = portfolioBase;
document.getElementById('portfolioBase').onchange = (e) => {
    portfolioBase = e.target.value;
    localStorage.setItem('portfolioBase', portfolioBase);
    renderPortfolio();
};

async function renderPortfolio() {
    const list = document.getElementById('portfolioList');
    if (portfolio.length === 0) {
        list.innerHTML = '';
        document.getElementById('portfolioTotal').textContent = '$0.00';
        if (portfolioChart) { portfolioChart.destroy(); portfolioChart = null; }
        return;
    }

    // Считаем стоимость каждого актива в USD
    const items = [];
    for (const asset of portfolio) {
        let usdValue = 0;
        try {
            const res = await fetch(`/api/convert?from=${asset.code}&to=USD&amount=${asset.amount}`);
            const data = await res.json();
            if (!data.error) usdValue = parseFloat(data.result);
        } catch (e) {}
        items.push({ ...asset, usdValue });
    }

    const totalUSD = items.reduce((s, i) => s + i.usdValue, 0);

    // Конвертируем общую сумму в базовую валюту
    let totalBase = totalUSD;
    if (portfolioBase !== 'USD') {
        try {
            const res = await fetch(`/api/convert?from=USD&to=${portfolioBase}&amount=${totalUSD}`);
            const data = await res.json();
            if (!data.error) totalBase = parseFloat(data.result);
        } catch (e) {}
    }

    const symbol = portfolioBase === 'USD' ? '$' : portfolioBase + ' ';
    document.getElementById('portfolioTotal').textContent =
        symbol + totalBase.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

    // Список активов
    list.innerHTML = items.map(i => {
        const icon = i.type === 'crypto'
            ? `<div class="crypto-icon" style="background:${i.color}">${i.icon}</div>`
            : `<div style="font-size:22px;width:40px;text-align:center">${i.icon}</div>`;
        const percent = totalUSD > 0 ? (i.usdValue / totalUSD * 100).toFixed(1) : 0;
        const valueBase = (i.usdValue / totalUSD) * totalBase;
        return `
            <div class="asset-item">
                <div class="icon">${icon}</div>
                <div class="info">
                    <div class="code">${i.amount} ${i.code}</div>
                    <div class="name">${i.name}</div>
                    <div class="asset-percent">${percent}% портфеля</div>
                </div>
                <div class="value">${symbol}${valueBase.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</div>
                <button class="asset-delete" data-id="${i.id}">✕</button>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.asset-delete').forEach(btn => {
        btn.onclick = () => {
            portfolio = portfolio.filter(a => a.id != btn.dataset.id);
            localStorage.setItem('portfolio', JSON.stringify(portfolio));
            renderPortfolio();
        };
    });

    // Круговая диаграмма
    renderPortfolioPie(items);
}

function renderPortfolioPie(items) {
    const ctx = document.getElementById('portfolioChart').getContext('2d');
    if (portfolioChart) portfolioChart.destroy();

    const colors = items.map((_, i) => {
        const palette = ['#667eea','#764ba2','#f093fb','#4facfe','#43e97b','#fa709a','#fee140','#30cfd0','#a8edea','#ff9a9e'];
        return palette[i % palette.length];
    });

    portfolioChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: items.map(i => i.code),
            datasets: [{
                data: items.map(i => i.usdValue),
                backgroundColor: colors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#666', padding: 10, font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: (item) => {
                            const total = item.dataset.data.reduce((a,b) => a+b, 0);
                            const percent = (item.parsed / total * 100).toFixed(1);
                            return `${item.label}: $${item.parsed.toFixed(2)} (${percent}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ============ АЛЕРТЫ ============
const alertModal = document.getElementById('alertModal');
document.getElementById('alertBtn').onclick = () => {
    document.getElementById('alertCurrency').textContent = `${selectedFrom.icon} ${selectedFrom.code} — ${selectedFrom.name}`;
    // Подставляем текущую цену
    let currentPrice = 0;
    if (selectedFrom.type === 'crypto') {
        currentPrice = rates.crypto[selectedFrom.code.toLowerCase()] || 0;
    } else if (rates.fiat[selectedFrom.code]) {
        currentPrice = 1 / rates.fiat[selectedFrom.code];
    }
    document.getElementById('alertTarget').value = currentPrice ? currentPrice.toFixed(2) : '';
    alertCondition = 'above';
    document.querySelectorAll('.cond-btn').forEach(b => b.classList.toggle('active', b.dataset.cond === 'above'));
    alertModal.classList.add('active');
};
document.getElementById('closeAlertModal').onclick = () => alertModal.classList.remove('active');
alertModal.onclick = (e) => { if (e.target === alertModal) alertModal.classList.remove('active'); };

document.querySelectorAll('.cond-btn').forEach(btn => {
    btn.onclick = () => {
        alertCondition = btn.dataset.cond;
        document.querySelectorAll('.cond-btn').forEach(b => b.classList.toggle('active', b === btn));
    };
});

document.getElementById('saveAlertBtn').onclick = async () => {
    const target = parseFloat(document.getElementById('alertTarget').value);
    if (!target || target <= 0) {
        tg.showPopup({ title: 'Ошибка', message: 'Введите целевую цену', buttons: [{ type: 'ok' }] });
        return;
    }
    try {
        const res = await fetch('/api/alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: tg.initDataUnsafe?.user?.id || 0,
                chatId: tg.initDataUnsafe?.user?.id || 0,
                code: selectedFrom.code,
                condition: alertCondition,
                targetPrice: target
            })
        });
        const data = await res.json();
        if (data.ok) {
            alertModal.classList.remove('active');
            tg.showPopup({
                title: '✅ Готово',
                message: `Уведомление создано!\nЯ сообщу, когда ${selectedFrom.code} ${alertCondition === 'above' ? 'превысит' : 'опустится ниже'} ${target}`,
                buttons: [{ type: 'ok' }]
            });
            tg.HapticFeedback.notificationOccurred('success');
            loadAlerts();
        }
    } catch (e) {
        tg.showPopup({ title: 'Ошибка', message: 'Не удалось создать уведомление', buttons: [{ type: 'ok' }] });
    }
};

async function loadAlerts() {
    const userId = tg.initDataUnsafe?.user?.id;
    if (!userId) {
        document.getElementById('alertsList').innerHTML = '';
        document.getElementById('alertsEmpty').style.display = 'block';
        return;
    }
    try {
        const res = await fetch(`/api/alerts/${userId}`);
        const userAlerts = await res.json();
        const list = document.getElementById('alertsList');
        const empty = document.getElementById('alertsEmpty');
        if (userAlerts.length === 0) {
            list.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';
        list.innerHTML = userAlerts.map(a => {
            const emoji = a.condition === 'above' ? '📈' : '📉';
            const word = a.condition === 'above' ? 'выше' : 'ниже';
            return `
                <div class="alert-item">
                    <div class="icon">${emoji}</div>
                    <div class="info">
                        <div class="code">${a.code}</div>
                        <div class="name">${word} ${a.targetPrice}</div>
                    </div>
                    <button class="asset-delete" data-id="${a.id}">✕</button>
                </div>
            `;
        }).join('');
        list.querySelectorAll('.asset-delete').forEach(btn => {
            btn.onclick = async () => {
                await fetch(`/api/alerts/${btn.dataset.id}`, { method: 'DELETE' });
                loadAlerts();
            };
        });
    } catch (e) {}
}

// ============ ИЗБРАННОЕ ============
document.getElementById('favBtn').onclick = () => {
    const key = `${selectedFrom.code}-${selectedTo.code}`;
    const idx = favorites.indexOf(key);
    if (idx >= 0) { favorites.splice(idx, 1); document.getElementById('favBtn').classList.remove('active'); }
    else { favorites.push(key); document.getElementById('favBtn').classList.add('active'); }
    localStorage.setItem('favorites', JSON.stringify(favorites));
    renderFavorites();
};

function renderFavorites() {
    const list = document.getElementById('favList');
    const empty = document.getElementById('favEmpty');
    if (favorites.length === 0) { list.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    list.innerHTML = favorites.map(f => {
        const [from, to] = f.split('-');
        return `
            <div class="rate-item" data-from="${from}" data-to="${to}">
                <div class="info">
                    <div class="code">${from} → ${to}</div>
                </div>
                <div class="price">→</div>
            </div>
        `;
    }).join('');
    list.querySelectorAll('.rate-item').forEach(item => {
        item.onclick = () => {
            const from = item.dataset.from, to = item.dataset.to;
            const fc = allCurrencies.find(c => c.code === from) || allCrypto.find(c => c.code === from);
            const tc = allCurrencies.find(c => c.code === to) || allCrypto.find(c => c.code === to);
            if (fc) { currentSelector = 'from'; selectCurrency(from, allCurrencies.includes(fc) ? 'fiat' : 'crypto'); }
            if (tc) { currentSelector = 'to'; selectCurrency(to, allCurrencies.includes(tc) ? 'fiat' : 'crypto'); }
            document.querySelector('[data-tab="converter"]').click();
        };
    });
}

// ============ ИСТОРИЯ ============
function addToHistory(amount, from, result, to) {
    const entry = { amount, fromCode: from.code, toCode: to.code, result, time: Date.now() };
    history.unshift(entry);
    if (history.length > 50) history.pop();
    localStorage.setItem('history', JSON.stringify(history));
}

// ============ КОПИРОВАНИЕ / ПОДЕЛИТЬСЯ ============
document.getElementById('copyBtn').onclick = () => {
    const text = document.getElementById('result').textContent;
    navigator.clipboard.writeText(text);
    tg.HapticFeedback.notificationOccurred('success');
    tg.showPopup({ title: 'Скопировано', message: text, buttons: [{ type: 'ok' }] });
};

document.getElementById('shareBtn').onclick = () => {
    const text = `${document.getElementById('amount').value} ${selectedFrom.code} = ${document.getElementById('result').textContent}`;
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(text)}`);
};

// ============ СТАРТ ============
loadData().then(() => {
    updateSelectorUI('from', selectedFrom);
    updateSelectorUI('to', selectedTo);
    updateChartCurrencyUI();
});