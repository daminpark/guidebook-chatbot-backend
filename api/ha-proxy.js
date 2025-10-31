// This function acts as a secure proxy to your Home Assistant instances.
// It is now corrected to properly handle the nested structure of the get_forecasts service response.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://manual.195vbr.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
      const forecastType = type.split('_')[0];
      response = await fetch(`${hassUrl}/api/services/weather/get_forecasts`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          entity_id: entity,
          type: forecastType
        }),
      });
      const rawData = await response.json();
      
      // *** THIS IS THE FIX ***
      // We now correctly look inside the object named after the entity to find the forecast array.
      // e.g., we look inside rawData['weather.forecast_home'] to find the 'forecast' key.
      data = (rawData[entity] && rawData[entity].forecast) ? rawData[entity].forecast : [];

    } else {
      response = await fetch(`${hassUrl}/api/states/${entity}`, { headers });
      data = await response.json();
    }

    if (!response.ok) {
      // Throw an error with the response body for better debugging
      const errorBody = await response.text();
      throw new Error(`Home Assistant API responded with status: ${response.status}. Body: ${errorBody}`);
    }
    
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600'); // Cache for 5 mins
    return res.status(200).json(data);

  } catch (error) {
    console.error(`Error in ha-proxy for entity ${entity} with type ${type}:`, error);
    return res.status(500).json({ error: 'Failed to fetch data from Home Assistant' });
  }
}