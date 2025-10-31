import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import ical from 'node-ical'; // <-- Import the new library

// --- Helper Functions for PIN Generation ---

/**
 * Extracts the last 4 digits from a phone number string.
 * @param {string} description - The full DESCRIPTION field from the iCal event.
 * @returns {string|null} The 4-digit PIN or null if not found.
 */
function getPinFromPhoneNumber(description) {
  if (!description) return null;
  const phoneMatch = description.match(/Phone:\s*(.*)/);
  if (!phoneMatch || !phoneMatch[1]) return null;
  
  const numericPhone = phoneMatch[1].replace(/\D/g, ''); // Strip all non-digit characters
  if (numericPhone.length < 4) return null;
  
  return numericPhone.slice(-4);
}

/**
 * Derives a fallback PIN from the guest's name.
 * @param {string} summary - The SUMMARY field from the iCal event.
 * @returns {string|null} The fallback PIN or null if no name is present.
 */
function getFallbackPinFromName(summary) {
    if (!summary) return null;
    // Remove "Airbnb", "Vrbo", etc., and clean up the name
    const cleanedName = summary.replace(/(Airbnb|Vrbo)\s*\(.*?\)\s*-\s*/i, '').trim();
    if (!cleanedName) return null;

    return cleanedName.replace(/\s+/g, '').toLowerCase().slice(0, 6);
}


// --- Main Handler ---

const redis = new Redis({
  url: process.env.UPSTAND_REDIS_REST_URL, // Corrected env var name
  token: process.env.UPSTAND_REDIS_REST_TOKEN,
});

const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"),
});

export default async function handler(req, res) {
  // CORS and Method Handling (no changes here)
  res.setHeader('Access-Control-Allow-Origin', 'https://manual.195vbr.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // --- 1. Key Parsing (no changes here) ---
    const { booking: opaqueBookingKey } = req.query;
    if (!opaqueBookingKey || !opaqueBookingKey.includes('-')) {
      return res.status(400).json({ error: 'Invalid or missing booking key.' });
    }
    const [bookingId, pinProvided] = opaqueBookingKey.split('-');
    if (!bookingId || !pinProvided) {
      return res.status(400).json({ error: 'Malformed booking key.' });
    }

    // --- 2. iCal URL Lookup (no changes here) ---
    const icalUrlEnvVarKey = `ICAL_URL_${bookingId}`;
    const icalUrl = process.env[icalUrlEnvVarKey];
    if (!icalUrl) {
      console.error(`[validate-booking] Secret iCal URL not found for key: ${icalUrlEnvVarKey}`);
      return res.status(404).json({ error: 'Booking not found.' });
    }

    // --- 3. Fetch and Parse iCal Data (NEW LOGIC) ---
    console.log(`[validate-booking] Fetching iCal data from URL for booking ID ${bookingId}`);
    const events = await ical.async.fromURL(icalUrl);
    let validPinFound = false;

    // --- 4. Iterate Events and Validate PIN (NEW LOGIC) ---
    for (const key in events) {
      if (events.hasOwnProperty(key)) {
        const event = events[key];
        if (event.type !== 'VEVENT') continue;

        const primaryPin = getPinFromPhoneNumber(event.description);
        const fallbackPin = getFallbackPinFromName(event.summary);

        console.log(`[validate-booking] Checking event: ${event.summary}. Primary PIN: ${primaryPin}, Fallback PIN: ${fallbackPin}`);

        // Compare the provided PIN with both the primary and fallback PINs.
        if (pinProvided === primaryPin || pinProvided === fallbackPin) {
          validPinFound = true;
          console.log(`[validate-booking] SUCCESS: Provided PIN matches for event: ${event.summary}`);
          break; // Exit the loop as soon as a match is found
        }
      }
    }

    // --- 5. Return Final Validation Result ---
    if (validPinFound) {
      // For now, we just confirm validation. Time-based logic will be added next.
      return res.status(200).json({
        access: "granted", // Temporary status
        message: "PIN validation successful."
      });
    } else {
      console.warn(`[validate-booking] No matching event found for provided PIN for booking ID ${bookingId}.`);
      // Use a generic error message for security
      return res.status(403).json({ error: 'Access Denied. The provided PIN is incorrect.' });
    }

  } catch (error) {
    console.error('[validate-booking] An unexpected error occurred:', error);
    // This could happen if the iCal URL is invalid or the server is down.
    if (error.message.includes('getaddrinfo ENOTFOUND')) {
         return res.status(502).json({ error: 'Could not retrieve booking data. The provider may be down.' });
    }
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}