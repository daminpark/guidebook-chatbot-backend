export default async function handler(req, res) {
  // CORS is handled by vercel.json. We only need to handle the OPTIONS preflight.
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const getParam = (param) => req.method === 'GET' ? req.query[param] : req.body[param];
  const house = getParam('house');

  let hassUrl = '';
  let hassToken = '';

  switch (house) {
    case '193':
      hassUrl = process.env.HASS_193_URL;
      hassToken = process.env.HASS_193_TOKEN;
      break;
    case '195':
      hassUrl = process.env.HASS_195_URL;
      hassToken = process.env.HASS_195_TOKEN;
      break;
    default:
      return res.status(400).json({ error: 'Invalid or missing house specified' });
  }

  if (!hassUrl || !hassToken) {
    return res.status(500).json({ error: 'Server configuration error for Home Assistant connection.' });
  }

  const headers = {
    'Authorization': `Bearer ${hassToken}`,
    'Content-Type': 'application/json',
  };

  try {
    if (req.method === 'GET') {
      const { entity, type = 'state' } = req.query;
      if (!entity) { return res.status(400).json({ error: 'Missing entity parameter' }); }

      let response;
      if (type === 'hourly_forecast' || type === 'daily_forecast') {
        const forecastType = type.split('_')[0];
        // THE FIX from before: Calling the get_forecasts service
        const forecastUrl = `${hassUrl}/api/services/weather/get_forecasts`;
        response = await fetch(forecastUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ entity_id: entity, type: forecastType }),
        });
      } else {
        response = await fetch(`${hassUrl}/api/states/${entity}`, { headers });
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Home Assistant API responded with status ${response.status}: ${errorBody}`);
      }
      
      const data = await response.json();
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
      return res.status(200).json(data);
    }
    
    if (req.method === 'POST') {
      const { entity, type, temperature } = req.body;
      if (!entity || !type) { return res.status(400).json({ error: 'Missing entity or type in POST body' }); }
      if (type !== 'set_temperature') { return res.status(400).json({ error: 'Unsupported POST type' }); }
      if (!entity.startsWith('climate.')) { return res.status(403).json({ error: 'Forbidden: Can only control climate entities.' }); }
      const tempNum = parseFloat(temperature);
      if (isNaN(tempNum) || tempNum < 7 || tempNum > 25) { return res.status(400).json({ error: 'Invalid temperature. Must be between 7 and 25.' }); }

      const serviceUrl = `${hassUrl}/api/services/climate/set_temperature`;
      const serviceBody = { entity_id: entity, temperature: tempNum };

      const response = await fetch(serviceUrl, { method: 'POST', headers: headers, body: JSON.stringify(serviceBody) });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Home Assistant service call failed with status ${response.status}: ${errorBody}`);
      }
      
      const data = await response.json();
      return res.status(200).json({ success: true, state: data });
    }

    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });

  } catch (error) {
    console.error(`Error in ha-proxy for house ${house}:`, error);
    return res.status(500).json({ error: 'Failed to communicate with Home Assistant' });
  }
}