// --- Find and REPLACE the entire contents of validate-booking.js ---

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import ical from 'node-ical';

// --- Helper Functions ---
function getPinFromPhoneNumber(description) {
  if (!description) return null;
  const phoneMatch = description.match(/Phone:\s*([+\d\s()-]+)/);
  if (!phoneMatch || !phoneMatch[1]) return null;
  const numericPhone = phoneMatch[1].replace(/\D/g, '');
  if (numericPhone.length < 8) return null;
  return numericPhone.slice(-8);
}

function getFallbackPinFromName(summary) {
    if (!summary) return null;
    const cleanedName = summary.replace(/(Airbnb|Vrbo)\s*\(.*?\)\s*-\s*/i, '').trim();
    if (!cleanedName) return null;
    return cleanedName.replace(/\s+/g, '').toLowerCase().slice(0, 6);
}

// --- NEW: Helper function to clean the guest name for display ---
function cleanGuestName(summary) {
    if (!summary) return "Valued Guest";
    // Removes booking platform prefixes like "Airbnb (H1234ABCD) - "
    return summary.replace(/(Airbnb|Vrbo)\s*\(.*?\)\s*-\s*/i, '').trim();
}

// --- Main Handler ---
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(60, "60 s"),
});

const LONDON_TIME_ZONE = 'Europe/London';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'GET') { return res.status(405).json({ error: 'Method Not Allowed' }); }

  const ip = req.headers['x-forwarded-for'] || '127.0.0.1';
  const { success } = await ratelimit.limit(ip);
  if (!success) {
    console.warn(`Rate limit exceeded for IP: ${ip}`);
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

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

      // --- NEW: Prepare personalized data for the response ---
      const guestName = cleanGuestName(matchedEvent.summary);
      const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: LONDON_TIME_ZONE };
      const checkInDateFormatted = checkInDate.toLocaleDateString('en-GB', dateOptions);
      const checkOutDateFormatted = checkOutDate.toLocaleDateString('en-GB', dateOptions);

      // --- MODIFIED: Return the new, richer data object ---
      return res.status(200).json({
          access: accessLevel,
          guestName: guestName,
          checkInDate: checkInDateFormatted,
          checkOutDate: checkOutDateFormatted
      });

    } else {
      return res.status(403).json({ error: 'Access Denied. The provided PIN is incorrect.' });
    }

  } catch (error) {
    console.error('[validate-booking] An unexpected error occurred:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}