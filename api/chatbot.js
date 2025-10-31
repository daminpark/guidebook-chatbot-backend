const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(20, "60 s"),
});

module.exports = async (req, res) => {
    // CORS is handled by vercel.json
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const ip = req.headers['x-forwarded-for'] || '127.0.0.1';
    const { success } = await ratelimit.limit(ip);
    if (!success) {
        return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    }
    
    try {
        const { history, context } = req.body;
        if (!context || !history || !Array.isArray(history) || history.length === 0) {
          return res.status(400).json({ error: 'Context and a valid chat history array are required' });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: context }] },
                { role: "model", parts: [{ text: "Yes, I am ready to help. I will use the provided context to answer questions about the guesthouse and my general knowledge for anything else." }] },
                ...history.slice(0, -1).map(msg => ({
                    role: msg.role,
                    parts: [{ text: msg.content }]
                }))
            ],
        });
        
        const lastMessage = history[history.length - 1].content;
        const result = await chat.sendMessageStream(lastMessage);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');

        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            res.write(chunkText);
        }

        res.end();

    } catch (error) {
        console.error("Error in Vercel function:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to get a response from the AI' });
        } else {
            res.end();
        }
    }
};