const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');
const ical = require('node-ical');

// --- Configuration ---
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(10, "60 s"),
});

const ICAL_URLS = {
    '31': process.env.ICAL_URL_31,
    '32': process.env.ICAL_URL_32,
    // Add all your other booking keys here
    // e.g., '3a': process.env.ICAL_URL_3A,
    '195vbr': process.env.ICAL_URL_195VBR,
};

// --- Helper Functions ---
function getPinFromPhone(description) {
    const phoneMatch = description.match(/Phone:\s*([+\d\s()-]+)/);
    if (!phoneMatch || !phoneMatch[1]) return null;
    const digits = phoneMatch[1].replace(/\D/g, '');
    return digits.slice(-4);
}

function getPinFromName(summary) {
    if (!summary || summary.toLowerCase() === 'blocked') return null;
    return summary.replace(/\s+/g, '').toLowerCase().slice(0, 6);
}

// --- Main Serverless Function Handler ---
module.exports = async (req, res) => {
    // STEP 1: Set CORS Headers on EVERY response. This is the permission slip.
    // For testing, this must be your exact frontend preview URL.
    res.setHeader('Access-Control-Allow-Origin', 'https://195vbr-git-pwprotected195vbr-pierre-parks-projects.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Add a log to prove the function is being hit by any request.
    console.log(`Request received for method: ${req.method}`);

    // STEP 2: Handle the browser's OPTIONS preflight security check.
    // This MUST come before any other logic.
    if (req.method === 'OPTIONS') {
        console.log('Responding to OPTIONS preflight request.');
        return res.status(200).end();
    }
    
    // STEP 3: Handle the actual POST request with your data.
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Now, proceed with the rest of your logic...
    const ip = req.headers['x-forwarded-for'] || '127.0.0.1';
    const { success } = await ratelimit.limit(ip);
    if (!success) {
        return res.status(429).json({ error: 'Too many requests.' });
    }

    try {
        const { bookingCode } = req.body;
        console.log('Handling POST request with booking code:', bookingCode);

        if (!bookingCode || !bookingCode.includes('-')) {
            return res.status(400).json({ error: 'A valid booking code is required.' });
        }

        const [bookingKey, password] = bookingCode.split('-', 2);

        if (!bookingKey || !password) {
            return res.status(400).json({ error: 'Malformed booking code.' });
        }

        const icalUrl = ICAL_URLS[bookingKey];
        if (!icalUrl) {
            console.error(`Error: No iCal URL found for booking key "${bookingKey}". Check environment variables.`);
            return res.status(404).json({ error: 'Invalid booking key.' });
        }

        const events = await ical.async.fromURL(icalUrl);
        const now = new Date();

        for (const event of Object.values(events)) {
            if (event.type !== 'VEVENT') continue;

            const description = event.description || '';
            const summary = event.summary || '';
            const expectedPassword = getPinFromPhone(description) || getPinFromName(summary);

            if (password === expectedPassword) {
                const eventStart = new Date(event.start);
                const eventEnd = new Date(event.end);
                
                // Rule 1: Controls are valid from 11:00 UTC on check-in day to 11:00 UTC on check-out day.
                const controlsStart = new Date(eventStart.getTime());
                controlsStart.setUTCHours(11, 0, 0, 0);

                const controlsEnd = new Date(eventEnd.getTime());
                controlsEnd.setUTCHours(11, 0, 0, 0);

                // Rule 2: Info is valid until 23:00 UTC on check-out day.
                const infoEnd = new Date(eventEnd.getTime());
                infoEnd.setUTCHours(23, 0, 0, 0);

                // Check the current time against these precise windows.
                if (now > infoEnd) {
                    // Booking is fully expired. Check the next event in the calendar.
                    continue;
                }

                if (now >= controlsStart && now < controlsEnd) {
                    // Current booking, within smart home control window.
                    return res.status(200).json({ accessLevel: 'full' });
                }
                
                if (now < infoEnd) {
                    // Booking is either in the future, or it's past the control time but before info expires.
                    // In either case, they get partial access.
                    return res.status(200).json({ accessLevel: 'partial' });
                }
            }
        }

        // If the loop finishes without finding a valid, current booking for that password
        return res.status(401).json({ accessLevel: 'none', error: 'Invalid credentials or booking not found.' });

    } catch (error) {
        console.error("Authentication error:", error);
        return res.status(500).json({ error: 'An internal server error occurred.' });
    }
};