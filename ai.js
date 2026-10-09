/* ai.js — Client wrapper for the Gemini Cloud Function proxy */
(function () {
    'use strict';

    const PROXY_URL = '/api/ai';

    const CACHE_PREFIX = 'pos_ai_cache_';
    const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

    function readCache(key) {
        try {
            const raw = localStorage.getItem(CACHE_PREFIX + key);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (!entry || !entry.ts || Date.now() - entry.ts > CACHE_TTL_MS) return null;
            return entry.data;
        } catch (e) { return null; }
    }

    function writeCache(key, data) {
        try {
            localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
        } catch (e) {}
    }

    function clearCache() {
        try {
            Object.keys(localStorage)
                .filter(k => k.startsWith(CACHE_PREFIX))
                .forEach(k => localStorage.removeItem(k));
        } catch (e) {}
    }

    async function callProxy(prompt, task) {
        const res = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, task })
        });

        if (!res.ok) {
            let msg = '';
            try { msg = (await res.json()).error || ''; } catch (e) {}
            throw new Error(msg || `AI is temporarily unavailable (${res.status}). Try again in a moment.`);
        }

        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'AI proxy failed');

        let parsed = null;
        try {
            parsed = JSON.parse(json.text);
        } catch (e) {
            const m = String(json.text).match(/\{[\s\S]*\}/);
            if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} }
        }
        return { raw: json.text, parsed };
    }

    async function forecastSales({ forceRefresh = false } = {}) {
        const cacheKey = 'forecast_14d';
        if (!forceRefresh) {
            const cached = readCache(cacheKey);
            if (cached) return cached;
        }

        const orders = JSON.parse(localStorage.getItem('pos_orders') || '[]');
        const byDay = {};
        const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;

        orders.forEach(o => {
            const ts = new Date(o.createdAt).getTime();
            if (isNaN(ts) || ts < cutoff) return;
            const key = new Date(ts).toISOString().split('T')[0];
            byDay[key] = (byDay[key] || 0) + (Number(o.total) || 0);
        });

        const daily = Object.entries(byDay)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, revenue]) => ({ date, revenue: Math.round(revenue * 100) / 100 }));

        if (daily.length < 7) {
            return {
                forecast: [],
                summary: 'Not enough sales history yet — need at least 7 days of data.',
                trend: 'stable'
            };
        }

        const prompt = buildForecastPrompt(daily);
        const { parsed } = await callProxy(prompt, 'forecast');

        const result = parsed && Array.isArray(parsed.forecast) && parsed.forecast.length > 0
            ? parsed
            : { forecast: [], summary: 'AI returned an unexpected response.', trend: 'stable' };

        writeCache(cacheKey, result);
        return result;
    }

    function buildForecastPrompt(daily) {
        const total = daily.reduce((s, d) => s + d.revenue, 0);
        const avg = total / daily.length;

        const byWeekday = {};
        daily.forEach(d => {
            const wd = new Date(d.date).toLocaleDateString('en-PH', { weekday: 'long' });
            (byWeekday[wd] = byWeekday[wd] || []).push(d.revenue);
        });
        const weekdayAverages = Object.fromEntries(
            Object.entries(byWeekday).map(([wd, arr]) => [
                wd,
                Math.round(arr.reduce((s, v) => s + v, 0) / arr.length)
            ])
        );

        return `You are analyzing sales data for a small hardware store POS.

Historical daily revenue (last ${daily.length} days, oldest first):
${JSON.stringify(daily)}

Total: PHP ${total.toFixed(2)} across ${daily.length} days
Average: PHP ${avg.toFixed(2)}/day
Weekday averages: ${JSON.stringify(weekdayAverages)}

Forecast the next 14 days. Consider weekday patterns and any visible trend.
Return ONLY valid JSON in this exact shape (no markdown, no extra text):
{
  "forecast": [
    {"date": "YYYY-MM-DD", "revenue": <number>, "confidence": "low"|"medium"|"high"}
  ],
  "summary": "One short sentence summarizing the trend",
  "trend": "up" | "down" | "stable"
}

The forecast array must contain exactly 14 entries, starting tomorrow.`;
    }

    async function restockPriority({ forceRefresh = false } = {}) {
        const cacheKey = 'restock_priority';
        if (!forceRefresh) {
            const cached = readCache(cacheKey);
            if (cached) return cached;
        }

        const products = window.getInventorySnapshot?.() || [];
        const orders = JSON.parse(localStorage.getItem('pos_orders') || '[]');
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

        const sold30d = {};
        orders.forEach(o => {
            const ts = new Date(o.createdAt).getTime();
            if (isNaN(ts) || ts < cutoff) return;
            (o.items || []).forEach(item => {
                const name = String(item.name || '').toLowerCase();
                if (!name) return;
                sold30d[name] = (sold30d[name] || 0) + (Number(item.quantity) || 0);
            });
        });

        const candidates = products
            .map(p => ({
                name: p.name,
                stock: Number(p.quantity) || 0,
                minStock: Number(p.minStock ?? p.min_stock ?? 0) || 0,
                sold30d: sold30d[String(p.name).toLowerCase()] || 0
            }))
            .filter(p => p.sold30d > 0 || p.stock <= p.minStock * 2)
            .sort((a, b) => b.sold30d - a.sold30d)
            .slice(0, 25);

        if (candidates.length === 0) {
            const empty = { items: [] };
            writeCache(cacheKey, empty);
            return empty;
        }

        const prompt = buildRestockPrompt(candidates);
        const { parsed } = await callProxy(prompt, 'restock');

        const result = parsed && Array.isArray(parsed.items)
            ? parsed
            : { items: [] };

        writeCache(cacheKey, result);
        return result;
    }

    function buildRestockPrompt(candidates) {
        return `Rank these hardware store products by restock urgency.

Products:
${JSON.stringify(candidates)}

Rules:
- dailyRate = sold30d / 30
- daysLeft = stock / dailyRate  (if dailyRate is 0, daysLeft = 999)
- Urgency:
  - "critical" if daysLeft <= 3 OR stock === 0
  - "high"     if daysLeft <= 7
  - "medium"   if daysLeft <= 14
  - "low"      otherwise
- recommendedOrder = round up to enough for 30 days at current rate, to a sensible number (5, 10, 25, 50, 100, etc.)

Return ONLY valid JSON (no markdown):
{
  "items": [
    {
      "name": "<product name>",
      "urgency": "critical"|"high"|"medium"|"low",
      "daysLeft": <number>,
      "recommendedOrder": <number>,
      "reason": "<short reason, e.g. 'Sells 1.4/day, 4 days left'>"
    }
  ]
}

Sort by urgency (critical first), then by daysLeft ascending. Return at most 6 items.`;
    }

  async function askQuestion(question, history = []) {
    const trimmed = String(question || '').trim();
    if (!trimmed) return { answer: 'Please type a question.' };

    const orders = JSON.parse(localStorage.getItem('pos_orders') || '[]');
    const products = window.getInventorySnapshot?.() || [];

    const recent = orders.slice(0, 50).map(o => ({
        id: o.id,
        date: o.createdAt,
        customer: o.customerName || 'Walk-in',
        total: o.total,
        items: (o.items || []).map(i => ({ name: i.name, qty: i.quantity, price: i.price }))
    }));

    const catalog = products.slice(0, 100).map(p => ({
        name: p.name,
        category: p.category,
        stock: p.quantity,
        price: p.price
    }));

    // ---- Conversation memory ----
    // Keep the last N turns so the model can resolve follow-ups like
    // "and last week?" or "what about Tuesday?" without the user having
    // to re-state context. Each entry is { role: 'user' | 'ai', text, ts }.
    const HISTORY_TURNS = 8;
    const trimmedHistory = Array.isArray(history)
        ? history
            .filter(m => m && typeof m.text === 'string' && m.text.trim())
            .slice(-HISTORY_TURNS)
        : [];

    const historyBlock = trimmedHistory.length
        ? trimmedHistory
            .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
            .join('\n')
        : '(no previous turns — this is the first question)';

    const prompt = `You are answering questions about a small hardware store POS system.

Context:
- Today's date: ${new Date().toISOString().split('T')[0]}
- Total orders on record: ${orders.length}
- Total products in inventory: ${products.length}

Recent orders (last 50, newest first):
${JSON.stringify(recent)}

Product catalog (first 100):
${JSON.stringify(catalog)}

Previous conversation (oldest → newest):
${historyBlock}

User's new question: ${trimmed}

Instructions:
- If the new question is a follow-up (e.g. "and last week?", "what about Tuesday?", "why?", "show me more"), resolve it using the Previous conversation before answering.
- Otherwise answer the new question directly.
- Answer in 1-2 sentences, plain English, no markdown.
- Use ONLY the data above. Do NOT invent numbers.
- If the data is insufficient, say: "I don't have enough data to answer that."
- Include actual amounts (in PHP) when relevant.

Return ONLY valid JSON (no markdown):
{ "answer": "<your answer>" }`;

    const { parsed } = await callProxy(prompt, 'query');
    return parsed && parsed.answer
        ? parsed
        : { answer: 'AI returned an unexpected response.' };
}

    window.POS_AI = {
        forecastSales,
        restockPriority,
        askQuestion,
        clearCache,
        _callProxy: callProxy
    };
})();