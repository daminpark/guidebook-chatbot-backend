import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import ical from 'node-ical';

// --- Helper Functions for PIN Generation ---

/**
 * Extracts the last 4 digits from a phone number string using a specific, non-greedy regex.
 * @param {string} description - The full DESCRIPTION field from the iCal event.
 * @returns {string|null} The 4-digit PIN or null if not found.
 */
function getPinFromPhoneNumber(description) {
  if (!description) return null;
  // This regex specifically matches characters found in phone numbers (+, digits, spaces, (), -)
  // and stops when it encounters a character not in that set (e.g., a letter).
  const phoneMatch = description.match(/Phone:\s*([+\d\s()-]+)/);
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
    const cleanedName = summary.replace(/(Airbnb|Vrbo)\s*\(.*?\)\s*-\s*/i, '').trim();
    if (!cleanedName) return null;
    return cleanedName.replace(/\s+/g, '').toLowerCase().slice(0, 6);
}

// --- Main Handler ---

// Note: Ensure your Vercel environment variables are UPSTASH_... not UPSTAND_...
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"),
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://manual.195vbr.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { booking: opaqueBookingKey } = req.query;
    if (!opaqueBookingKey || !opaqueBookingKey.includes('-')) {
      return res.status(400).json({ error: 'Invalid or missing booking key.' });
    }
    const [bookingId, pinProvided] = opaqueBookingKey.split('-');
    if (!bookingId || !pinProvided) {
      return res.status(400).json({ error: 'Malformed booking key.' });
    }

    const icalUrlEnvVarKey = `ICAL_URL_${bookingId}`;
    const icalUrl = process.env[icalUrlEnvVarKey];
    if (!icalUrl) {
      console.error(`[validate-booking] Secret iCal URL not found for key: ${icalUrlEnvVarKey}`);
      return res.status(404).json({ error: 'Booking not found.' });
    }

    console.log(`[validate-booking] Fetching iCal data from URL for booking ID ${bookingId}`);
    const events = await ical.async.fromURL(icalUrl);
    let validPinFound = false;

    for (const key in events) {
      if (events.hasOwnProperty(key)) {
        const event = events[key];
        if (event.type !== 'VEVENT') continue;

        const primaryPin = getPinFromPhoneNumber(event.description);
        const fallbackPin = getFallbackPinFromName(event.summary);

        console.log(`[validate-booking] Checking event: ${event.summary}. Primary PIN: ${primaryPin}, Fallback PIN: ${fallbackPin}`);

        if (pinProvided === primaryPin || pinProvided === fallbackPin) {
          validPinFound = true;
          console.log(`[validate-booking] SUCCESS: Provided PIN matches for event: ${event.summary}`);
          break;
        }
      }
    }

    if (validPinFound) {
      return res.status(200).json({
        access: "granted",
        message: "PIN validation successful."
      });
    } else {
      console.warn(`[validate-booking] No matching event found for provided PIN for booking ID ${bookingId}.`);
      return res.status(403).json({ error: 'Access Denied. The provided PIN is incorrect.' });
    }

  } catch (error) {
    console.error('[validate-booking] An unexpected error occurred:', error);
    if (error.message.includes('getaddrinfo ENOTFOUND')) {
         return res.status(502).json({ error: 'Could not retrieve booking data. The provider may be down.' });
    }
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}