const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');

// Initialize Upstash Redis for rate limiting
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(20, "60 s"), // 20 requests per minute
});

// Main serverless function handler
module.exports = async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', 'https://manual.195vbr.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Enforce rate limiting
    const ip = req.headers['x-forwarded-for'] || '127.0.0.1';
    const { success } = await ratelimit.limit(ip);
    if (!success) {
        return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    }
    
    try {
        const { prompt, context } = req.body;
        if (!prompt || !context) {
          return res.status(400).json({ error: 'Prompt and context are required' });
        }

        // Initialize Google AI
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Generate content as a stream
        const result = await model.generateContentStream(context + "\n\nUser question: " + prompt);

        // Set headers for streaming response
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');

        // Pipe the stream from the AI to the client
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            res.write(chunkText);
        }

        // End the response stream
        res.end();

    } catch (error) {
        console.error("Error in Vercel function:", error);
        // Note: Can't send a JSON error if headers are already sent for streaming.
        // The client-side will handle this as a failed request.
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to get a response from the AI' });
        } else {
            res.end(); // Gracefully end the stream on error
        }
    }
};