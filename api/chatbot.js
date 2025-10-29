const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');

// Your guesthouse information (extracted from your HTML)
const guesthouseInfo = `
  Address: 193-195 Vauxhall Bridge Road, Pimlico, London, SW1V 1ER.
  Check-in: 3 PM (15:00) or later. Self check-in system.
  Luggage Drop-off: From 11:00 on check-in day in cupboard V.
  Luggage Storage after check-out: Until 14:00 in cupboard V.
  WiFi 1: SSID: 193, Password: 12345671
  WiFi 2: SSID: 195, Password: 09876543
  Heating: Controlled by a tablet on the wall. Heating turns off if any window is open.
  Cooling: No air conditioning. Recommend keeping windows and curtains closed during the day and opening them in the evening.
  Locks: Front door/Cupboard V code is active 11:00 on check-in day to 14:00 on check-out day. Bedroom/Bathroom/Kitchen code is active 15:00 on check-in day to 11:00 on check-out day.
  Contact: Message through booking platform. Emergency WhatsApp: +44 7443 618207 or +44 7383 298999.
  Laundry: No guest machines. Recommended: True Colours Launderette. Fresh towels can be requested every 2 days by leaving used ones outside the door by 11:00am.
  TV: Smart TV with Disney+, Apple TV+, Amazon Prime Video. Contact host for login issues.
`;

// Initialize Upstash Redis for rate limiting
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"), // 5 requests per 60 seconds
});

// Main serverless function handler
module.exports = async (req, res) => {
    // Allow CORS for your GitHub Pages site
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', 'https://YOUR-GITHUB-USERNAME.github.io'); // IMPORTANT: Change this!
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Handle preflight request for CORS
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Rate Limiting
    const ip = req.headers['x-forwarded-for'] || '127.0.0.1';
    const { success } = await ratelimit.limit(ip);

    if (!success) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    
    try {
        const { prompt } = req.body;
        if (!prompt) {
          return res.status(400).json({ error: 'Prompt is required' });
        }

        // Initialize Gemini
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const fullPrompt = `Based on the following information about the guesthouse and general knowledge of London, answer the user's question. Guesthouse Info: ${guesthouseInfo}\n\nUser question: ${prompt}`;

        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();

        res.status(200).json({ response: text });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to get a response from the AI' });
    }
};
