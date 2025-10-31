import { permissions } from './_permissions.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const getParam = (param) => req.method === 'GET' ? req.query[param] : req.body[param];
  const house = getParam('house');

  let hassUrl, hassToken;
  switch (house) {
    case '193': hassUrl = process.env.HASS_193_URL; hassToken = process.env.HASS_193_TOKEN; break;
    case '195': hassUrl = process.env.HASS_195_URL; hassToken = process.env.HASS_195_TOKEN; break;
    default: return res.status(400).json({ error: 'Invalid house' });
  }
  if (!hassUrl || !hassToken) return res.status(500).json({ error: 'Server configuration error' });
  const headers = { 'Authorization': `Bearer ${hassToken}`, 'Content-Type': 'application/json' };

  try {
    if (req.method === 'GET') {
      const { entity, type = 'state' } = req.query;
      if (!entity) return res.status(400).json({ error: 'Missing entity' });
      let data;
      if (type === 'hourly_forecast' || type === 'daily_forecast') {
        const forecastType = type.split('_')[0];
        const forecastUrl = `${hassUrl}/api/services/weather/get_forecasts?return_response=true`;
        const response = await fetch(forecastUrl, { method: 'POST', headers, body: JSON.stringify({ entity_id: entity, type: forecastType }) });
        if (!response.ok) throw new Error(`HA API responded with status ${response.status}`);
        const responseJson = await response.json();
        if (responseJson?.service_response?.[entity]) {
            data = responseJson.service_response[entity].forecast;
        } else { data = []; }
      } else {
        const response = await fetch(`${hassUrl}/api/states/${entity}`, { headers });
        if (!response.ok) throw new Error(`HA API responded with status ${response.status}`);
        data = await response.json();
      }
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
      return res.status(200).json(data);
    }
    
    if (req.method === 'POST') {
      const { entity, type, temperature, opaqueBookingKey } = req.body;

      if (!opaqueBookingKey || !opaqueBookingKey.includes('-')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or malformed booking key.' });
      }
      
      const [bookingId] = opaqueBookingKey.split('-');
      const userPermissions = permissions[bookingId];
      if (!userPermissions) {
        return res.status(403).json({ error: 'Forbidden: Unknown booking ID.' });
      }

      // --- THIS IS THE CORRECTED LOGIC ---
      let permissionCategory = null;
      if (type === 'set_temperature') {
        permissionCategory = 'climate';
      }
      // Future service calls like 'turn_on' for a light would be added here.

      if (!permissionCategory) {
        return res.status(400).json({ error: 'Unsupported command type.' });
      }

      const allowedEntities = userPermissions[permissionCategory];
      if (!allowedEntities || !allowedEntities.includes(entity)) {
        console.warn(`[SECURITY] Forbidden attempt by booking ${bookingId} to control entity ${entity}`);
        return res.status(403).json({ error: 'Forbidden: You do not have permission to control this device.' });
      }
      
      // If we pass all checks, proceed
      if (type === 'set_temperature') {
        const tempNum = parseFloat(temperature);
        if (isNaN(tempNum) || tempNum < 7 || tempNum > 25) return res.status(400).json({ error: 'Invalid temperature' });
        
        const serviceUrl = `${hassUrl}/api/services/climate/set_temperature`;
        const serviceBody = { entity_id: entity, temperature: tempNum };
        const response = await fetch(serviceUrl, { method: 'POST', headers, body: JSON.stringify(serviceBody) });

        if (!response.ok) throw new Error(`HA service call failed`);
        const responseData = await response.json();
        return res.status(200).json({ success: true, state: responseData });
      }

      return res.status(400).json({ error: 'Unsupported POST type' });
    }

    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });

  } catch (error) {
    console.error(`Error in ha-proxy for house ${house}:`, error.message);
    // Return a JSON error instead of raw text/html
    return res.status(500).json({ error: 'A server error occurred while communicating with Home Assistant.' });
  }
}