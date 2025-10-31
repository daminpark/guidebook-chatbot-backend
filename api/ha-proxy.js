export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const getParam = (param) => req.method === 'GET' ? req.query[param] : req.body[param];
  const house = getParam('house');

  let hassUrl, hassToken;
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
    return res.status(500).json({ error: 'Server configuration error for HA connection.' });
  }

  const headers = { 'Authorization': `Bearer ${hassToken}`, 'Content-Type': 'application/json' };

  try {
    if (req.method === 'GET') {
      const { entity, type = 'state' } = req.query;
      if (!entity) return res.status(400).json({ error: 'Missing entity parameter' });

      let data;

      if (type === 'hourly_forecast' || type === 'daily_forecast') {
        const forecastType = type.split('_')[0];
        
        // --- THIS IS THE CRITICAL FIX ---
        // 'return_response=true' is a query parameter in the URL.
        const forecastUrl = `${hassUrl}/api/services/weather/get_forecasts?return_response=true`;
        
        const response = await fetch(forecastUrl, {
          method: 'POST',
          headers,
          // The body does NOT contain 'return_response'.
          body: JSON.stringify({ entity_id: entity, type: forecastType }),
        });
        
        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`HA API responded with status ${response.status}: ${errorBody}`);
        }
        
        const responseJson = await response.json();

        // And this is the correct parsing logic based on your data dump.
        if (responseJson && responseJson.service_response && responseJson.service_response[entity]) {
            data = responseJson.service_response[entity].forecast;
        } else {
            data = [];
        }

      } else {
        const response = await fetch(`${hassUrl}/api/states/${entity}`, { headers });
        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`HA API responded with status ${response.status}: ${errorBody}`);
        }
        data = await response.json();
      }
      
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
      return res.status(200).json(data);
    }
    
    if (req.method === 'POST') {
        const { entity, type, temperature } = req.body;
        if (!entity || !type) { return res.status(400).json({ error: 'Missing entity or type' }); }
        if (type !== 'set_temperature') { return res.status(400).json({ error: 'Unsupported POST type' }); }
        if (!entity.startsWith('climate.')) { return res.status(403).json({ error: 'Forbidden' }); }
        const tempNum = parseFloat(temperature);
        if (isNaN(tempNum) || tempNum < 7 || tempNum > 25) { return res.status(400).json({ error: 'Invalid temperature' }); }

        const serviceUrl = `${hassUrl}/api/services/climate/set_temperature`;
        const serviceBody = { entity_id: entity, temperature: tempNum };

        const response = await fetch(serviceUrl, { method: 'POST', headers, body: JSON.stringify(serviceBody) });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`HA service call failed: ${errorBody}`);
        }
        const responseData = await response.json();
        return res.status(200).json({ success: true, state: responseData });
    }

    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });

  } catch (error) {
    console.error(`Error in ha-proxy for house ${house}:`, error.message);
    return res.status(500).json({ error: 'Failed to communicate with Home Assistant' });
  }
}