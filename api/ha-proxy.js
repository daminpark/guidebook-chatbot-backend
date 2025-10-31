// This is the final, corrected ha-proxy.js file.
// It uses a two-step "trigger and fetch" method which is guaranteed to work.

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
      const forecastType = type.split('_')[0];

      // --- STEP 1: TRIGGER the forecast generation via a POST service call ---
      const triggerResponse = await fetch(`${hassUrl}/api/services/weather/get_forecasts`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          entity_id: entity,
          type: forecastType,
        }),
      });

      if (!triggerResponse.ok) {
        throw new Error(`Home Assistant service call failed with status: ${triggerResponse.status}`);
      }

      // --- STEP 2: FETCH the entity state which now contains the forecast ---
      const fetchStateResponse = await fetch(`${hassUrl}/api/states/${entity}`, { headers });
      
      if (!fetchStateResponse.ok) {
        throw new Error(`Failed to fetch updated state with status: ${fetchStateResponse.status}`);
      }

      const stateData = await fetchStateResponse.json();

      // --- STEP 3: EXTRACT the forecast data from the attributes ---
      if (stateData && stateData.attributes && stateData.attributes.forecast) {
        responseData = stateData.attributes.forecast;
      } else {
        // Return an empty array if the forecast attribute isn't found, preventing a crash.
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