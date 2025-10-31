// This is the definitive and final version.
// It is based on the actual successful curl response from the user's server.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://manual.195vbr.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
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
      const forecastUrl = `${hassUrl}/api/services/weather/get_forecasts?return_response=true`;
      
      response = await fetch(forecastUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          entity_id: entity,
          type: forecastType
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Home Assistant API responded with status ${response.status}: ${errorBody}`);
      }

      const responseJson = await response.json();
      
      // THE FIX IS HERE: We use the correct path to the forecast data.
      if (responseJson && responseJson.service_response && responseJson.service_response[entity]) {
        data = responseJson.service_response[entity].forecast;
      } else {
        // Fallback in case the response structure is unexpectedly different.
        data = [];
      }

    } else {
      // The simple GET request for the state remains the same.
      response = await fetch(`${hassUrl}/api/states/${entity}`, { headers });
      data = await response.json();
    }
    
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
    return res.status(200).json(data);

  } catch (error) {
    console.error(`Error in ha-proxy for entity ${entity} with type ${type}:`, error);
    return res.status(500).json({ error: 'Failed to fetch data from Home Assistant' });
  }
}