// This function acts as a secure proxy to your Home Assistant instances.
// It uses server-side environment variables to keep your tokens safe.

export default async function handler(req, res) {
  // Allow requests from your guidebook's domain. This is important!
  res.setHeader('Access-Control-Allow-Origin', 'https://manual.195vbr.com'); // Replace with your actual front-end domain if different
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { house, entity } = req.query;

  let hassUrl = '';
  let hassToken = '';

  // Securely select the correct credentials based on the 'house' query parameter
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

    const response = await fetch(`${hassUrl}/api/states/${entity}`, { headers });

    if (!response.ok) {
      throw new Error(`Home Assistant API responded with status: ${response.status}`);
    }

    const data = await response.json();
    
    // Set caching headers to prevent hitting your HA instance too often
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
    
    // *** THIS IS THE FIX ***
    // We now return the COMPLETE data object, including the 'attributes'
    // that the weather card needs.
    return res.status(200).json(data);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch data from Home Assistant' });
  }
}