import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Initialize Upstash Redis for rate limiting (we'll activate this later)
// It's good practice to set it up now.
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"), // Allow 5 attempts per minute
});

export default async function handler(req, res) {
  // --- Standard CORS and Method Handling ---
  res.setHeader('Access-Control-Allow-Origin', 'https://manual.195vbr.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // --- Rate Limiting (will be enabled in a later step) ---
  // const ip = req.headers['x-forwarded-for'] || '127.0.0.1';
  // const { success } = await ratelimit.limit(ip);
  // if (!success) {
  //   console.warn(`Rate limit exceeded for IP: ${ip}`);
  //   return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  // }

  try {
    // --- 1. Extract and Parse the Opaque Booking Key ---
    const { booking: opaqueBookingKey } = req.query; // e.g., "31-6556"
    console.log(`[validate-booking] Received opaque key: ${opaqueBookingKey}`);

    if (!opaqueBookingKey || !opaqueBookingKey.includes('-')) {
      console.error("[validate-booking] Invalid or missing booking key format.");
      return res.status(400).json({ error: 'Invalid or missing booking key.' });
    }

    const [bookingId, pin] = opaqueBookingKey.split('-'); // bookingId="31", pin="6556"
    console.log(`[validate-booking] Parsed Booking ID: ${bookingId}, Parsed PIN: ${pin}`);

    if (!bookingId || !pin) {
      console.error("[validate-booking] Parsing failed. Booking ID or PIN is missing after split.");
      return res.status(400).json({ error: 'Malformed booking key.' });
    }

    // --- 2. Securely Map Public Booking ID to Secret iCal URL ---
    // This uses a dynamic key to access the environment variable.
    // e.g., if bookingId is "31", it looks for process.env.ICAL_URL_31
    const icalUrlEnvVarKey = `ICAL_URL_${bookingId}`;
    const icalUrl = process.env[icalUrlEnvVarKey];
    
    console.log(`[validate-booking] Looking for environment variable: ${icalUrlEnvVarKey}`);

    if (!icalUrl) {
      console.error(`[validate-booking] Secret iCal URL not found for key: ${icalUrlEnvVarKey}`);
      // Respond with a generic error to avoid leaking information about which booking IDs are valid.
      return res.status(404).json({ error: 'Booking not found.' });
    }

    console.log(`[validate-booking] Successfully found iCal URL for Booking ID ${bookingId}.`);

    // --- Placeholder Success Response ---
    // In the next step, we will replace this with the actual iCal parsing and validation logic.
    return res.status(200).json({
      message: "Stage 1 complete: Key parsed and iCal URL found.",
      bookingId: bookingId,
      pinProvided: pin,
      icalUrlFound: true
    });

  } catch (error) {
    console.error('[validate-booking] An unexpected error occurred:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}