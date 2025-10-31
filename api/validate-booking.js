import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import ical from 'node-ical';

// (Helper functions are unchanged)
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

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"),
});

export default async function handler(req, res) {
  // --- ALL CORS HEADERS HAVE BEEN REMOVED ---
  // Vercel.json now handles this for the entire project.

  if (req.method === 'OPTIONS') {
    // Even with vercel.json, it's good practice to handle OPTIONS pre-emptively.
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // (The rest of the logic is exactly the same)
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
          break;
        }
      }
    }

    if (matchedEvent) {
      const now = new Date();
      const checkInDate = matchedEvent.start;
      const checkOutDate = matchedEvent.end;
      const fullAccessStart = new Date(Date.UTC(checkInDate.getUTCFullYear(), checkInDate.getUTCMonth(), checkInDate.getUTCDate(), 11, 0, 0));
      const fullAccessEnd = new Date(Date.UTC(checkOutDate.getUTCFullYear(), checkOutDate.getUTCMonth(), checkOutDate.getUTCDate(), 11, 0, 0));
      const gracePeriodEnd = new Date(Date.UTC(checkOutDate.getUTCFullYear(), checkOutDate.getUTCMonth(), checkOutDate.getUTCDate(), 23, 0, 0));

      let accessLevel = 'denied';
      if (now >= fullAccessStart && now < fullAccessEnd) {
        accessLevel = 'full';
      } else if (now < fullAccessStart || (now >= fullAccessEnd && now < gracePeriodEnd)) {
        accessLevel = 'partial';
      }

      if (accessLevel === 'denied') {
        return res.status(403).json({ error: 'Access Denied. This booking link has expired.' });
      }

      return res.status(200).json({ access: accessLevel, guest: matchedEvent.summary });
    } else {
      return res.status(403).json({ error: 'Access Denied. The provided PIN is incorrect.' });
    }

  } catch (error) {
    console.error('[validate-booking] An unexpected error occurred:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}