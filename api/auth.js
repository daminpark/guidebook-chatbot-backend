// In api/auth.js

// ... (redis, ratelimit, ICAL_URLS, helper functions are unchanged) ...

module.exports = async (req, res) => {
    // ... (CORS, method checks, rate limiting are unchanged) ...

    try {
        // --- MODIFICATION START ---
        const { bookingCode } = req.body; // Expecting a single combined code, e.g., "31-6556"
        console.log('Received request with booking code:', bookingCode);

        if (!bookingCode || !bookingCode.includes('-')) {
            console.log('Error: Malformed booking code.');
            return res.status(400).json({ error: 'A valid booking code is required.' });
        }

        const [bookingKey, password] = bookingCode.split('-', 2); // Split into two parts
        // --- MODIFICATION END ---

        if (!bookingKey || !password) {
            return res.status(400).json({ error: 'Malformed booking code.' });
        }

        const icalUrl = ICAL_URLS[bookingKey];
        console.log('Attempting to fetch iCal from URL for key:', bookingKey);

        if (!icalUrl) {
            console.log('Error: No iCal URL found for this booking key.'); // <-- ADD THIS
            return res.status(404).json({ error: 'Invalid booking key.' });
        }

        // The rest of the function logic remains exactly the same...
        const events = await ical.async.fromURL(icalUrl);
        // ... loop through events, check password, etc.

    } catch (error) {
        console.error("Authentication error:", error);
        return res.status(500).json({ error: 'An internal server error occurred.' });
    }
};