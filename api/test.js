// api/test.js
module.exports = (req, res) => {
    // Set the CORS headers
    res.setHeader('Access-Control-Allow-Origin', 'https://195vbr-git-pwprotected195vbr-pierre-parks-projects.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle the preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Handle the actual request
    res.status(200).json({ message: 'CORS test successful!' });
};