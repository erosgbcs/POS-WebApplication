// api/ai.js — Vercel serverless function: Gemini API proxy
// The API key lives only in Vercel env vars, never reaches the browser.

const GEMINI_MODEL = 'gemini-3.8-flash'; // <-- KEPT as requested
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Vercel config — Hobby caps at 10s regardless; Pro honors this.
export const config = { maxDuration: 30 };

// ---------- Rate limiting (best-effort per instance) ----------
const rateState = { count: 0, windowStart: Date.now() };
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;

function rateLimitOk() {
    const now = Date.now();
    if (now - rateState.windowStart > RATE_WINDOW_MS) {
        rateState.count = 0;
        rateState.windowStart = now;
    }
    rateState.count++;
    return rateState.count <= RATE_LIMIT;
}

// ---------- Retry tuning ----------
// Single-attempt timeout. Higher = fewer false 504s when Gemini is slow,
// but retries stack and must stay under Vercel's 10s hard cap on Hobby.
//   2 attempts × 8s abort = 16s worst case → WILL hit the platform cap.
// To keep 8s AND stay under 10s, set MAX_ATTEMPTS = 1.
const MAX_ATTEMPTS = 1;
const BASE_DELAY_MS = 400;
const ABORT_MS = 8000;
const RETRYABLE_STATUSES = new Set([503, 429, 500, 504]);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    if (!rateLimitOk()) {
        res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
        return;
    }

    const { prompt, task } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'Missing prompt' });
        return;
    }
    if (prompt.length > 20000) {
        res.status(400).json({ error: 'Prompt too long (max 20,000 chars)' });
        return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY not set in environment');
        res.status(500).json({ error: 'AI service not configured' });
        return;
    }

    const requestBody = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.35,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json'
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
        ]
    });

    try {
        let upstream = null;
        let lastStatus = 0;
        let lastBody = '';

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const controller = new AbortController();
            const abortTimer = setTimeout(() => controller.abort(), ABORT_MS);

            try {
                upstream = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: requestBody
                });
            } finally {
                clearTimeout(abortTimer);
            }

            if (upstream.ok) break;

            lastStatus = upstream.status;
            lastBody = await upstream.text();

            const retryable = RETRYABLE_STATUSES.has(lastStatus);
            if (!retryable || attempt === MAX_ATTEMPTS) break;

            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 250;
            console.warn(`Gemini ${lastStatus} on attempt ${attempt}/${MAX_ATTEMPTS} — retrying in ${Math.round(delay)}ms`);
            await new Promise(r => setTimeout(r, delay));
        }

        if (!upstream || !upstream.ok) {
            console.error('Gemini upstream error after retries', lastStatus, lastBody.slice(0, 400));
            const friendly = lastStatus === 503
                ? 'AI is busy right now — please try again in a few seconds.'
                : lastStatus === 429
                    ? 'AI rate limit reached — try again in a minute.'
                    : `AI upstream error (${lastStatus})`;
            res.status(503).json({ error: friendly });
            return;
        }

        const data = await upstream.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        res.status(200).json({ ok: true, task: task || 'generic', text });

    } catch (err) {
        if (err?.name === 'AbortError') {
            console.error('Gemini call aborted after', ABORT_MS, 'ms');
            res.status(504).json({ error: 'AI took too long to respond. Try again.' });
            return;
        }
        console.error('Proxy error', err);
        res.status(500).json({ error: err.message || 'Unknown error' });
    }
}