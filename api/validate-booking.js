import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import ical from 'node-ical';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz'; // <-- Import new date functions

// --- Helper Functions (No changes here) ---
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
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const events = await ical.async.fromURL(icalUrl);
    let matchedEvent = null; // <-- Will store the matching event object

    for (const key in events) {
      if (events.hasOwnProperty(key)) {
        const event = events[key];
        if (event.type !== 'VEVENT') continue;

        const primaryPin = getPinFromPhoneNumber(event.description);
        const fallbackPin = getFallbackPinFromName(event.summary);

        if (pinProvided === primaryPin || pinProvided === fallbackPin) {
          matchedEvent = event; // <-- We found our event, store it
          console.log(`[validate-booking] SUCCESS: PIN match for event: ${event.summary}`);
          break;
        }
      }
    }

    // --- 5. Time-Based Access Control (NEW LOGIC) ---
    if (matchedEvent) {
      const now = new Date();
      
      // The iCal dates are "floating" dates. We must treat them as London dates.
      // `node-ical` correctly parses them into the system's timezone, so we convert them.
      const checkInDate = matchedEvent.start;
      const checkOutDate = matchedEvent.end;
      
      // Define the key time boundaries in London time
      const fullAccessStart = zonedTimeToUtc(new Date(checkInDate.setHours(11, 0, 0, 0)), LONDON_TIME_ZONE);
      const fullAccessEnd = zonedTimeToUtc(new Date(checkOutDate.setHours(11, 0, 0, 0)), LONDON_TIME_ZONE);
      const gracePeriodEnd = zonedTimeToUtc(new Date(checkOutDate.setHours(23, 0, 0, 0)), LONDON_TIME_ZONE);
      
      console.log(`[validate-booking] Current Time (UTC): ${now.toISOString()}`);
      console.log(`[validate-booking] Full Access Start (UTC): ${fullAccessStart.toISOString()}`);
      console.log(`[validate-booking] Full Access End (UTC): ${fullAccessEnd.toISOString()}`);
      console.log(`[validate-booking] Grace Period End (UTC): ${gracePeriodEnd.toISOString()}`);

      let accessLevel = 'denied';

      // Determine the access level based on the current time
      if (now >= fullAccessStart && now < fullAccessEnd) {
        accessLevel = 'full';
      } else if (now < fullAccessStart || (now >= fullAccessEnd && now < gracePeriodEnd)) {
        // This covers both pre-stay and the post-stay grace period
        accessLevel = 'partial';
      }
      
      // If access is still denied, it means the grace period has expired.
      if (accessLevel === 'denied') {
        console.warn(`[validate-booking] Access denied for ${matchedEvent.summary}. The link has expired.`);
        return res.status(403).json({ error: 'Access Denied. This booking link has expired.' });
      }

      console.log(`[validate-booking] Access level determined: ${accessLevel}`);
      
      // Return the final, successful response
      return res.status(200).json({
        access: accessLevel,
        guest: matchedEvent.summary, // Send some useful info to the frontend
      });

    } else {
      console.warn(`[validate-booking] No matching event found for provided PIN.`);
      return res.status(403).json({ error: 'Access Denied. The provided PIN is incorrect.' });
    }

  } catch (error) {
    console.error('[validate-booking] An unexpected error occurred:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}