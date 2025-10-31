const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');
const ical = require('node-ical');
// Import the date parser to handle iCal's specific date objects
const { VEvent } = require('node-ical');

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
    // ...add all other booking keys
    '195vbr': process.env.ICAL_URL_195VBR,
};

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

module.exports = async (req, res) => {
    // ... (CORS and method checks are unchanged) ...
    res.setHeader('Access-Control-Allow-Origin', '*'); // Or your specific frontend preview URL for testing
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });


    const ip = req.headers['x-forwarded-for'] || '127.0.0.1';
    const { success } = await ratelimit.limit(ip);
    if (!success) {
        return res.status(429).json({ error: 'Too many requests.' });
    }

    try {
        const { bookingCode } = req.body;
        if (!bookingCode || !bookingCode.includes('-')) {
            return res.status(400).json({ error: 'A valid booking code is required.' });
        }

        const [bookingKey, password] = bookingCode.split('-', 2);

        if (!bookingKey || !password) {
            return res.status(400).json({ error: 'Malformed booking code.' });
        }

        const icalUrl = ICAL_URLS[bookingKey];
        if (!icalUrl) {
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
                // --- NEW TIME LOGIC START ---

                // Parse the start/end dates from the event
                const eventStart = new Date(event.start);
                const eventEnd = new Date(event.end);
                
                // Rule 1: Controls are valid from 11:00 on check-in day to 11:00 on check-out day.
                // We use setUTCHours to avoid timezone issues on the server.
                const controlsStart = new Date(eventStart.getTime());
                controlsStart.setUTCHours(11, 0, 0, 0);

                const controlsEnd = new Date(eventEnd.getTime());
                controlsEnd.setUTCHours(11, 0, 0, 0);

                // Rule 2: Info is valid until 23:00 on check-out day.
                const infoEnd = new Date(eventEnd.getTime());
                infoEnd.setUTCHours(23, 0, 0, 0);

                // --- NEW TIME LOGIC END ---

                // Now, check the current time against these precise windows.
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