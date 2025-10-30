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
  limiter: Ratelimit.slidingWindow(5, "60 s"), // Allows 5 requests per minute per user
});

// Main serverless function handler
module.exports = async (req, res) => {
    // Set CORS headers to allow requests only from your website
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', 'https://manual.195vbr.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Handle the browser's preflight request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Enforce rate limiting based on the user's IP address
    const ip = req.headers['x-forwarded-for'] || '127.0.0.1';
    const { success } = await ratelimit.limit(ip);
    if (!success) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    
    try {
        // Get the prompt and the context sent from your website
        const { prompt, context } = req.body;
        if (!prompt || !context) {
          return res.status(400).json({ error: 'Prompt and context are required' });
        }

        // Initialize the Google Generative AI model
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

        // Create the final, detailed prompt for the AI
        const fullPrompt = `Based on the following information, answer the user's question. Information: ${context}\n\nUser question: ${prompt}`;

        // Get the response from the AI
        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();

        // Send the AI's answer back to your website
        res.status(200).json({ response: text });
    } catch (error) {
        console.error("Error in Vercel function:", error);
        res.status(500).json({ error: 'Failed to get a response from the AI' });
    }
};
