// This function acts as a secure proxy to your Home Assistant instances.
// It is now updated to handle both simple state requests and specific forecast requests.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://manual.195vbr.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { house, entity, type = 'state' } = req.query; // Default to 'state' if no type is provided

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

    // *** THIS IS THE NEW LOGIC ***
    // We check the 'type' to decide which Home Assistant API to call.
    if (type === 'hourly_forecast' || type === 'daily_forecast') {
      const forecastType = type.split('_')[0]; // 'hourly' or 'daily'
      response = await fetch(`${hassUrl}/api/services/weather/get_forecasts`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          entity_id: entity,
          type: forecastType
        }),
      });
      data = await response.json();
      // The forecast data is returned directly in the response for this service call
      data = data[entity].forecast; 
    } else {
      // For 'state' requests (occupancy sensors, current weather), use the simple GET request
      response = await fetch(`${hassUrl}/api/states/${entity}`, { headers });
      data = await response.json();
    }

    if (!response.ok) {
      throw new Error(`Home Assistant API responded with status: ${response.status}`);
    }
    
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
    return res.status(200).json(data);

  } catch (error) {
    console.error(`Error in ha-proxy for entity ${entity} with type ${type}:`, error);
    return res.status(500).json({ error: 'Failed to fetch data from Home Assistant' });
  }
}