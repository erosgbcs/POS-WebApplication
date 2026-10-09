// api/ai.js — Vercel serverless function: Gemini API proxy
// The API key lives only in Vercel env vars, never reaches the browser.

const GEMINI_MODEL = 'gemini-2.5-flash'; // <-- UPDATED to latest stable version
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

    try {
        const upstream = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
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
            })
        });

        if (!upstream.ok) {
            const body = await upstream.text();
            console.error('Gemini upstream error', upstream.status, body.slice(0, 400));
            res.status(502).json({ error: `AI upstream error (${upstream.status})` });
            return;
        }

        const data = await upstream.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        res.status(200).json({ ok: true, task: task || 'generic', text });
    } catch (err) {
        console.error('Proxy error', err);
        res.status(500).json({ error: err.message || 'Unknown error' });
    }
}