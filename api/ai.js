// api/ai.js — Vercel serverless function: AI proxy with Gemini + Groq fallback

// --- Gemini Config ---
const GEMINI_MODEL = 'gemini-2.5-flash'; 
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// --- Groq Config ---
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

export const config = { maxDuration: 30 };

// ---------- Rate limiting (best-effort per instance) ----------
const rateState = { count: 0, windowStart: Date.now() };
const RATE_LIMIT = 12; // Lowered to protect Gemini's 15 RPM limit
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
const MAX_ATTEMPTS = 1; // Single attempt per provider
const ABORT_MS = 8000; 
const RETRYABLE_STATUSES = new Set([429, 500, 503, 504]);

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

    // =================================================================
    // ATTEMPT 1: Gemini
    // =================================================================
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (geminiApiKey) {
        try {
            const geminiBody = JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.35,
                    maxOutputTokens: 2048,
                    responseMimeType: 'application/json'
                },
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
                ]
            });

            const controller = new AbortController();
            const abortTimer = setTimeout(() => controller.abort(), ABORT_MS);
            let response;
            try {
                response = await fetch(`${GEMINI_URL}?key=${geminiApiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: geminiBody
                });
            } finally {
                clearTimeout(abortTimer);
            }

            if (response.ok) {
                const data = await response.json();
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                return res.status(200).json({ ok: true, task: task || 'generic', provider: 'gemini', text });
            }
            
            const errBody = await response.text();
            console.warn(`Gemini failed with status ${response.status}. Body: ${errBody.slice(0, 200)}. Falling back to Groq.`);

        } catch (error) {
            console.warn(`Gemini fetch error: ${error.message}. Falling back to Groq.`);
        }
    } else {
        console.warn('GEMINI_API_KEY not set. Skipping Gemini, trying Groq.');
    }

    // =================================================================
    // ATTEMPT 2: Groq (Fallback)
    // =================================================================
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
        console.error('GROQ_API_KEY not set. Cannot fall back.');
        return res.status(500).json({ error: 'AI service not configured (no fallback available)' });
    }

    try {
        const groqBody = JSON.stringify({
            model: GROQ_MODEL,
            messages: [
                { role: 'system', content: 'You must respond with valid JSON only. Do not wrap the JSON in markdown.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.35,
            max_tokens: 2048,
            response_format: { type: 'json_object' }
        });

        const controller = new AbortController();
        const abortTimer = setTimeout(() => controller.abort(), ABORT_MS);
        let response;
        try {
            response = await fetch(GROQ_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${groqApiKey}`
                },
                signal: controller.signal,
                body: groqBody
            });
        } finally {
            clearTimeout(abortTimer);
        }

        if (!response.ok) {
            const errBody = await response.text();
            console.error(`Groq failed with status ${response.status}. Body: ${errBody.slice(0, 400)}`);
            return res.status(502).json({ error: `AI fallback error (${response.status})` });
        }

        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content || '';
        return res.status(200).json({ ok: true, task: task || 'generic', provider: 'groq', text });

    } catch (error) {
        console.error('Groq proxy error:', error);
        if (error.name === 'AbortError') {
            return res.status(504).json({ error: 'AI fallback timed out. Please try again.' });
        }
        return res.status(500).json({ error: error.message || 'Unknown AI fallback error' });
    }
}