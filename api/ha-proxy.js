// --- PERMISSIONS ---
// These maps define which booking IDs can control which entities.
// This is a critical security layer, preventing guests from controlling devices not assigned to them.
const climatePermissions = {
  "31": ["climate.3_1_trv"], "32": ["climate.3_2_trv"], "33": ["climate.3_c_trv", "climate.3_3_trv"], "34": ["climate.3_4_trv"], "35": ["climate.3_5_trv"], "36": ["climate.3_6_trv"], "3a": ["climate.3_1_trv", "climate.3_2_trv"], "3b": ["climate.3_4_trv", "climate.3_5_trv", "climate.3_6_trv"],
  "51": ["climate.5_1_trv"], "52": ["climate.5_2_trv"], "53": ["climate.5_c_trv", "climate.5_3_trv"], "54": ["climate.5_4_trv"], "55": ["climate.5_5_trv"], "56": ["climate.5_6_trv"], "5a": ["climate.5_1_trv", "climate.5_2_trv"], "5b": ["climate.5_4_trv", "climate.5_5_trv", "climate.5_6_trv"],
  "193vbr": ["climate.3_1_trv", "climate.3_2_trv", "climate.3_3_trv", "climate.3_c_trv", "climate.3_4_trv", "climate.3_5_trv", "climate.3_6_trv"],
  "195vbr": ["climate.5_1_trv", "climate.5_2_trv", "climate.5_3_trv", "climate.5_c_trv", "climate.5_4_trv", "climate.5_5_trv", "climate.5_6_trv"]
};
const lightPermissions = {
    "31": ["light.3_1_lights"], "32": ["light.3_2_lights"], "33": ["light.3_3_lights", "light.3_3_lamp", "light.3_c_lights"], "34": ["light.3_4_lights", "light.3_4_lamp"], "35": ["light.3_5_lights"], "36": ["light.3_6_lights"], "3a": ["light.3_1_lights", "light.3_2_lights"], "3b": ["light.3_4_lights", "light.3_4_lamp", "light.3_5_lights", "light.3_6_lights"],
    "51": ["light.5_1_lights"], "52": ["light.5_2_lights"], "53": ["light.5_3_lights", "light.5_3_lamp", "light.5_c_lights"], "54": ["light.5_4_lights", "light.5_4_lamp"], "55": ["light.5_5_lights"], "56": ["light.5_6_lights"], "5a": ["light.5_1_lights", "light.5_2_lights"], "5b": ["light.5_4_lights", "light.5_4_lamp", "light.5_5_lights", "light.5_6_lights"],
    "193vbr": ["light.3_1_lights", "light.3_2_lights", "light.3_3_lights", "light.3_3_lamp", "light.3_c_lights", "light.3_4_lights", "light.3_4_lamp", "light.3_5_lights", "light.3_6_lights"],
    "195vbr": ["light.5_1_lights", "light.5_2_lights", "light.5_3_lights", "light.5_3_lamp", "light.5_c_lights", "light.5_4_lights", "light.5_4_lamp", "light.5_5_lights", "light.5_6_lights"]
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const getParam = (param) => req.method === 'GET' ? req.query[param] : req.body[param];
  const house = getParam('house');
  const opaqueBookingKey = getParam('opaqueBookingKey');

  if (!opaqueBookingKey || !opaqueBookingKey.includes('-')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or malformed booking key.' });
  }
  
  // Dynamic Vercel URL construction for validation
  const host = req.headers.host;
  const protocol = host.startsWith('localhost') ? 'http://' : 'https://';
  const validationUrl = `${protocol}${host}/api/validate-booking?booking=${opaqueBookingKey}`;

  const validationResponse = await fetch(validationUrl);
  const validationData = await validationResponse.json();

  if (!validationResponse.ok || !validationData.access || validationData.access === 'denied') {
      console.warn(`[SECURITY] ha-proxy access blocked for key ${opaqueBookingKey}. Access level: denied`);
      return res.status(403).json({ error: 'Forbidden: Your booking is not valid or has expired.' });
  }

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
        if (responseJson?.service_response?.[entity]) { data = responseJson.service_response[entity].forecast; } else { data = []; }
      } else {
        const response = await fetch(`${hassUrl}/api/states/${entity}`, { headers });
        if (!response.ok) throw new Error(`HA API responded with status ${response.status}`);
        data = await response.json();
      }
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
      return res.status(200).json(data);
    }
    
    if (req.method === 'POST') {
      if (validationData.access !== 'full') {
        console.warn(`[SECURITY] POST command blocked for key ${opaqueBookingKey}. Access level: ${validationData.access}`);
        return res.status(403).json({ error: 'Forbidden: Your booking is not currently active for sending commands.' });
      }

      const { entity, type, temperature } = req.body;
      const [bookingId] = opaqueBookingKey.split('-');
      
      let userPermissions, permissionCategory, service, serviceBody;

      if (type === 'set_temperature') {
        permissionCategory = 'climate';
        userPermissions = climatePermissions[bookingId];
        service = 'climate/set_temperature';
        const tempNum = parseFloat(temperature);
        if (isNaN(tempNum) || tempNum < 7 || tempNum > 25) return res.status(400).json({ error: 'Invalid temperature' });
        serviceBody = { entity_id: entity, temperature: tempNum };
      } else if (type === 'toggle_light') {
        permissionCategory = 'lights';
        userPermissions = lightPermissions[bookingId];
        service = 'light/toggle';
        serviceBody = { entity_id: entity };
      } else {
        return res.status(400).json({ error: 'Unsupported command type.' });
      }
      
      if (!userPermissions || !userPermissions.includes(entity)) {
        console.warn(`[SECURITY] Forbidden attempt by booking ${bookingId} to control entity ${entity} in category ${permissionCategory}`);
        return res.status(403).json({ error: 'Forbidden: You do not have permission to control this device.' });
      }
      
      const serviceUrl = `${hassUrl}/api/services/${service}`;
      const response = await fetch(serviceUrl, { method: 'POST', headers, body: JSON.stringify(serviceBody) });

      if (!response.ok) throw new Error(`HA service call failed with status ${response.status}`);
      const responseData = await response.json();
      return res.status(200).json({ success: true, state: responseData });
    }

    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });

  } catch (error) {
    console.error(`Error in ha-proxy for house ${house}:`, error.message);
    return res.status(500).json({ error: 'A server error occurred while communicating with Home Assistant.' });
  }
}