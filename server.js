require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// 24-hour in-memory cache
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const NHTSA_BASE = 'https://api.nhtsa.gov';

app.get('/api/safety', async (req, res) => {
  const { year, make, model, vehicleId } = req.query;

  if (!year || !make || !model) {
    return res.status(400).json({ error: 'year, make, and model are required' });
  }

  const cacheKey = `${year}-${make}-${model}-${vehicleId || ''}`.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    // Fetch recalls
    const recallsUrl = `${NHTSA_BASE}/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;
    const recallsRes = await fetch(recallsUrl);
    const recallsData = await recallsRes.json();
    const recalls = recallsData.results || recallsData.Results || [];

    // Fetch safety ratings
    let ratings = null;
    let variants = [];

    if (vehicleId) {
      // Fetch by specific vehicleId
      const ratingsUrl = `${NHTSA_BASE}/SafetyRatings/VehicleId/${vehicleId}`;
      const ratingsRes = await fetch(ratingsUrl);
      const ratingsData = await ratingsRes.json();
      if (ratingsData.Results && ratingsData.Results.length > 0) {
        ratings = ratingsData.Results[0];
      }
    } else {
      // Get variants for this year/make/model
      const variantsUrl = `${NHTSA_BASE}/SafetyRatings/modelyear/${encodeURIComponent(year)}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`;
      const variantsRes = await fetch(variantsUrl);
      const variantsData = await variantsRes.json();
      variants = variantsData.Results || [];

      if (variants.length === 1) {
        // Auto-fetch ratings for the single variant
        const vid = variants[0].VehicleId;
        const ratingsUrl = `${NHTSA_BASE}/SafetyRatings/VehicleId/${vid}`;
        const ratingsRes = await fetch(ratingsUrl);
        const ratingsData = await ratingsRes.json();
        if (ratingsData.Results && ratingsData.Results.length > 0) {
          ratings = ratingsData.Results[0];
        }
      }
    }

    const data = {
      year,
      make,
      model,
      ratings,
      variants: vehicleId ? [] : variants,
      recalls
    };

    cache.set(cacheKey, { ts: Date.now(), data });
    return res.json(data);
  } catch (err) {
    console.error('NHTSA fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch NHTSA data' });
  }
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Car Truth running on http://localhost:${PORT}`);
  });
}
