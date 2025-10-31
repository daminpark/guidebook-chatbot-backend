import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import ical from 'node-ical';

// --- Helper Functions (No changes) ---
function getPinFromPhoneNumber(description) {
  if (!description) return null;
  const phoneMatch = description.match(/Phone:\s*([+\d\s()-]+)/);
  if (!phoneMatch || !phoneMatch[1]) return null;
  const numericPhone = phoneMatch[1].replace(/\D/g, '');
  if (numericPhone.length < 4) return null;
  return numericPhone.slice(-4);
}

function getFallbackPinFromName(summary) {
    if (!summary) return null;
    const cleanedName = summary.replace(/(Airbnb|Vrbo)\s*\(.*?\)\s*-\s*/i, '').trim();
    if (!cleanedName) return null;
    return cleanedName.replace(/\s+/g, '').toLowerCase().slice(0, 6);
}

// --- Main Handler ---
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"),
});

const LONDON_TIME_ZONE = 'Europe/London';

/**
 * Creates a new Date object correctly representing a given time in London.
 * This avoids external libraries by using the built-in Intl.DateTimeFormat.
 * @param {Date} date The source date
 * @returns {Date} A new Date object that is timezone-correct for comparison.
 */
function getLondonDate(date) {
    // Get the date and time parts in the London timezone
    const options = { timeZone: LONDON_TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };
    const formatter = new Intl.DateTimeFormat('en-GB', options);
    const parts = formatter.formatToParts(date);
    
    const partValue = (type) => parts.find(p => p.type === type)?.value || '0';

    // Reconstruct a date string in a format that new Date() can parse reliably (YYYY-MM-DDTHH:mm:ss)
    const y = partValue('year');
    const m = partValue('month');
    const d = partValue('day');
    const hr = partValue('hour') === '24' ? '00' : partValue('hour'); // Handle 24-hour clock edge case
    const min = partValue('minute');
    const sec = partValue('second');
    
    // The resulting Date object will be in the system's timezone (UTC on Vercel),
    // but the *time value* it holds will be equivalent to the wall-clock time in London.
    return new Date(`${y}-${m}-${d}T${hr}:${min}:${sec}Z`);
}

export default async function handler(req, res) {
  // CORS and Method handling (no change)
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
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const events = await ical.async.fromURL(icalUrl);
    let matchedEvent = null;

    for (const key in events) {
      if (events.hasOwnProperty(key)) {
        const event = events[key];
        if (event.type !== 'VEVENT') continue;
        const primaryPin = getPinFromPhoneNumber(event.description);
        const fallbackPin = getFallbackPinFromName(event.summary);
        if (pinProvided === primaryPin || pinProvided === fallbackPin) {
          matchedEvent = event;
          console.log(`[validate-booking] SUCCESS: PIN match for event: ${event.summary}`);
          break;
        }
      }
    }

    if (matchedEvent) {
      const now = new Date();
      
      // The iCal dates are parsed as local to the server (UTC).
      const checkInDate = matchedEvent.start;
      const checkOutDate = matchedEvent.end;

      // Define the key time boundaries. These are UTC dates representing the London time.
      const fullAccessStart = new Date(Date.UTC(checkInDate.getUTCFullYear(), checkInDate.getUTCMonth(), checkInDate.getUTCDate(), 11, 0, 0));
      const fullAccessEnd = new Date(Date.UTC(checkOutDate.getUTCFullYear(), checkOutDate.getUTCMonth(), checkOutDate.getUTCDate(), 11, 0, 0));
      const gracePeriodEnd = new Date(Date.UTC(checkOutDate.getUTCFullYear(), checkOutDate.getUTCMonth(), checkOutDate.getUTCDate(), 23, 0, 0));

      console.log(`[validate-booking] Current Time (UTC): ${now.toISOString()}`);
      console.log(`[validate-booking] Full Access Start (UTC): ${fullAccessStart.toISOString()}`);
      console.log(`[validate-booking] Full Access End (UTC): ${fullAccessEnd.toISOString()}`);
      console.log(`[validate-booking] Grace Period End (UTC): ${gracePeriodEnd.toISOString()}`);

      let accessLevel = 'denied';

      if (now >= fullAccessStart && now < fullAccessEnd) {
        accessLevel = 'full';
      } else if (now < fullAccessStart || (now >= fullAccessEnd && now < gracePeriodEnd)) {
        accessLevel = 'partial';
      }

      if (accessLevel === 'denied') {
        console.warn(`[validate-booking] Access denied for ${matchedEvent.summary}. The link has expired.`);
        return res.status(403).json({ error: 'Access Denied. This booking link has expired.' });
      }

      console.log(`[validate-booking] Access level determined: ${accessLevel}`);
      return res.status(200).json({ access: accessLevel, guest: matchedEvent.summary });

    } else {
      console.warn(`[validate-booking] No matching event found for provided PIN.`);
      return res.status(403).json({ error: 'Access Denied. The provided PIN is incorrect.' });
    }

  } catch (error) {
    console.error('[validate-booking] An unexpected error occurred:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}