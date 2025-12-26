const express = require('express');
const fetch = require('node-fetch');

console.log('🚀 Starting Railway VPN Proxy...');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // WAJIB untuk Railway

// ======================
// WAJIB: Healthcheck endpoints untuk Railway
// ======================

// Endpoint utama yang DICEK oleh Railway
app.get('/', (req, res) => {
  console.log('✓ Health check received at /');
  res.status(200).json({
    status: 'ok',
    service: 'railway-vpn-proxy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    message: 'Server is running on Railway'
  });
});

// Backup health check endpoint
app.get('/health', (req, res) => {
  console.log('✓ Health check received at /health');
  res.status(200).json({
    status: 'healthy',
    checks: {
      server: 'up',
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    }
  });
});

// ======================
// Basic Routes
// ======================

app.get('/status', (req, res) => {
  res.json({
    online: true,
    port: PORT,
    host: HOST,
    node: process.version,
    env: process.env.NODE_ENV || 'production'
  });
});

app.get('/sub', async (req, res) => {
  try {
    // Fetch proxy list
    const proxyUrl = process.env.PROXY_BANK_URL || 'https://raw.githubusercontent.com/FoolVPN-ID/Nautica/main/proxyList.txt';
    const response = await fetch(proxyUrl);
    const text = await response.text();
    const proxies = text.split('\n').filter(line => line.trim()).slice(0, 10);
    
    const hostname = req.get('host') || `localhost:${PORT}`;
    const uuid = '12345678-1234-1234-1234-123456789012'; // Contoh UUID
    
    const configs = proxies.map((line, i) => {
      const [ip, port, country] = line.split(',');
      return {
        vless_tls: `vless://${uuid}@${hostname}:443?type=ws&security=tls&path=/ws#${country || 'ID'}-${i}`,
        vless_ntls: `vless://${uuid}@${hostname}:80?type=ws&security=none&path=/ws#${country || 'ID'}-${i}`,
        info: { ip, port, country }
      };
    });
    
    res.json({
      count: configs.length,
      hostname: hostname,
      configs: configs
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/sub', (req, res) => {
  const hostname = req.get('host') || `localhost:${PORT}`;
  const uuid = '12345678-1234-1234-1234-123456789012';
  
  // Contoh config minimal
  const config = `vless://${uuid}@${hostname}:443?type=ws&security=tls&path=/ws#Railway-VPN`;
  
  res.set('Content-Type', 'text/plain');
  res.send(config);
});

// ======================
// Start Server
// ======================

app.listen(PORT, HOST, () => {
  console.log(`✅ Server BERHASIL running on ${HOST}:${PORT}`);
  console.log(`🔗 Local: http://localhost:${PORT}`);
  console.log(`🌐 Health Check: http://${HOST}:${PORT}/`);
  console.log(`🏥 Health Backup: http://${HOST}:${PORT}/health`);
  console.log(`📊 Status: http://${HOST}:${PORT}/status`);
  
  // Test server immediately
  console.log('\n=== Testing Server... ===');
  fetch(`http://localhost:${PORT}/`)
    .then(res => console.log(`✓ Root endpoint: ${res.status}`))
    .catch(err => console.log(`✗ Root endpoint error: ${err.message}`));
    
  fetch(`http://localhost:${PORT}/health`)
    .then(res => console.log(`✓ Health endpoint: ${res.status}`))
    .catch(err => console.log(`✗ Health endpoint error: ${err.message}`));
});
