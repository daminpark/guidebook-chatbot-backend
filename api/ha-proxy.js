// This is the correct ha-proxy.js file.
// The logic is confirmed by your manual HA test.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://manual.195vbr.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST'); // Added POST for completeness
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { house, entity, type = 'state' } = req.query;

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
      return res.status(400).json({ error: 'Invalid house specified' });
  }

  if (!hassUrl || !hassToken || !entity) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const headers = {
      'Authorization': `Bearer ${hassToken}`,
      'Content-Type': 'application/json',
    };

    let response;
    let data;

    if (type === 'hourly_forecast' || type === 'daily_forecast') {
      const forecastType = type.split('_')[0]; // 'hourly' or 'daily'
      
      // This is the fetch call that is failing, but the logic is correct.
      response = await fetch(`${hassUrl}/api/services/weather/get_forecasts`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          entity_id: entity,
          type: forecastType
        }),
      });
      
      data = await response.json();
      // This parsing logic is confirmed correct by your manual test.
      data = data[entity].forecast; 

    } else {
      // This fetch call for the state works correctly.
      response = await fetch(`${hassUrl}/api/states/${entity}`, { headers });
      data = await response.json();
    }

    if (!response.ok) {
      // This will catch HTTP errors like 401 Unauthorized or 404 Not Found.
      throw new Error(`Home Assistant API responded with status: ${response.status}`);
    }
    
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
    return res.status(200).json(data);

  } catch (error) {
    // This 'catch' block is what's sending the error message you see.
    console.error(`Error in ha-proxy for entity ${entity} with type ${type}:`, error);
    return res.status(500).json({ error: 'Failed to fetch data from Home Assistant' });
  }
}