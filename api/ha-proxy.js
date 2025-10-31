// This is the final version. It corrects the 400 Bad Request error.

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

    let responseData;

    if (type === 'hourly_forecast' || type === 'daily_forecast') {
      
      // STEP 1: TRIGGER the forecast generation.
      // THE FIX IS HERE: We have removed the 'type' parameter from the body.
      const triggerResponse = await fetch(`${hassUrl}/api/services/weather/get_forecasts`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          entity_id: entity
        }),
      });

      if (!triggerResponse.ok) {
        // We now provide a more detailed error message for debugging.
        const errorBody = await triggerResponse.text();
        throw new Error(`HA service call failed with status ${triggerResponse.status}: ${errorBody}`);
      }

      // STEP 2: FETCH the entity state which now contains the forecast.
      const fetchStateResponse = await fetch(`${hassUrl}/api/states/${entity}`, { headers });
      
      if (!fetchStateResponse.ok) {
        throw new Error(`Failed to fetch updated state with status: ${fetchStateResponse.status}`);
      }

      const stateData = await fetchStateResponse.json();

      // STEP 3: EXTRACT the forecast data.
      if (stateData && stateData.attributes && stateData.attributes.forecast) {
        responseData = stateData.attributes.forecast;
      } else {
        responseData = [];
      }
    } else {
      // For simple 'state' requests, just fetch the state directly.
      const response = await fetch(`${hassUrl}/api/states/${entity}`, { headers });
      responseData = await response.json();
    }
    
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
    return res.status(200).json(responseData);

  } catch (error) {
    console.error(`Error in ha-proxy for entity ${entity} with type ${type}:`, error);
    return res.status(500).json({ error: 'Failed to fetch data from Home Assistant' });
  }
}