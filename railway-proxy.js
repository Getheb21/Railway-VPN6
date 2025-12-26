const express = require('express');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const crypto = require('crypto');

// ======================
// CONFIGURASI
// ======================
const CONFIG = {
  PORT: process.env.PORT || 3000,
  HOST: '0.0.0.0', // Railway memerlukan ini
  SERVICE_NAME: process.env.SERVICE_NAME || 'railway-vpn5',
  PROXY_BANK_URL: process.env.PROXY_BANK_URL || 'https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/proxyList.txt',
  PROXY_PER_PAGE: 20,
  CACHE_DURATION: 300000 // 5 menit
};

console.log('🚀 Starting Railway Proxy Server...');
console.log(`Port: ${CONFIG.PORT}`);
console.log(`Service: ${CONFIG.SERVICE_NAME}`);

// ======================
// INIT APP
// ======================
const app = express();
const server = require('http').createServer(app);

// Middleware sederhana
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.json());

// ======================
// HEALTH CHECK ENDPOINT (WAJIB untuk Railway)
// ======================
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: CONFIG.SERVICE_NAME,
    message: 'Railway Proxy Server is running',
    timestamp: new Date().toISOString(),
    endpoints: {
      subscription: '/sub/:page',
      api: '/api/v1/sub',
      health: '/health',
      check: '/check',
      myip: '/api/v1/myip'
    }
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    service: CONFIG.SERVICE_NAME,
    port: CONFIG.PORT,
    timestamp: new Date().toISOString(),
    node_version: process.version
  });
});

// ======================
// HELPER FUNCTIONS
// ======================
let cachedProxies = [];
let lastCacheUpdate = 0;

function generateUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : 
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
}

async function fetchProxyList() {
  try {
    console.log('📥 Fetching proxy list...');
    const response = await fetch(CONFIG.PROXY_BANK_URL, {
      timeout: 10000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const text = await response.text();
    const lines = text.trim().split('\n').filter(line => line.trim());
    
    cachedProxies = lines.map((line, index) => {
      const parts = line.split(',');
      return {
        id: index + 1,
        ip: parts[0]?.trim() || 'Unknown',
        port: parts[1]?.trim() || 'Unknown',
        country: parts[2]?.trim() || 'Unknown',
        org: parts[3]?.trim() || 'Unknown',
        raw: line
      };
    });
    
    lastCacheUpdate = Date.now();
    console.log(`✅ Loaded ${cachedProxies.length} proxies`);
    return cachedProxies;
  } catch (error) {
    console.error('❌ Error fetching proxies:', error.message);
    return cachedProxies.length > 0 ? cachedProxies : [];
  }
}

// ======================
// ROUTES
// ======================
app.get('/sub/:page?', async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 0;
    const hostname = req.get('host') || 'localhost:' + CONFIG.PORT;
    
    const proxies = await fetchProxyList();
    const start = page * CONFIG.PROXY_PER_PAGE;
    const end = start + CONFIG.PROXY_PER_PAGE;
    const pageProxies = proxies.slice(start, end);
    
    const html = generateHTML(pageProxies, page, hostname);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.get('/api/v1/sub', async (req, res) => {
  try {
    const format = req.query.format || 'raw';
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const hostname = req.get('host') || 'localhost:' + CONFIG.PORT;
    
    const proxies = await fetchProxyList();
    const selectedProxies = proxies.slice(0, limit);
    
    const configs = [];
    const uuid = generateUUID();
    
    selectedProxies.forEach(proxy => {
      // VLESS TLS
      configs.push(`vless://${uuid}@${hostname}:443?type=ws&security=tls&host=${hostname}&path=/${proxy.ip}-${proxy.port}#${proxy.country}-TLS`);
      // VLESS NTLS
      configs.push(`vless://${uuid}@${hostname}:80?type=ws&security=none&host=${hostname}&path=/${proxy.ip}-${proxy.port}#${proxy.country}-NTLS`);
      // Trojan TLS
      configs.push(`trojan://${uuid}@${hostname}:443?type=ws&security=tls&host=${hostname}&path=/${proxy.ip}-${proxy.port}#${proxy.country}-TLS`);
      // Trojan NTLS
      configs.push(`trojan://${uuid}@${hostname}:80?type=ws&security=none&host=${hostname}&path=/${proxy.ip}-${proxy.port}#${proxy.country}-NTLS`);
    });
    
    let output = configs.join('\n');
    
    if (['clash', 'sfa', 'bfr'].includes(format)) {
      try {
        const converterRes = await fetch('https://api.foolvpn.me/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: configs.join(','),
            format: format,
            template: 'cf'
          })
        });
        
        if (converterRes.ok) {
          output = await converterRes.text();
        }
      } catch (error) {
        console.error('Converter error:', error.message);
      }
    }
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(output);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.get('/check', async (req, res) => {
  try {
    const target = req.query.target;
    if (!target) {
      return res.status(400).json({ error: 'Target required' });
    }
    
    // Simulasi check sederhana
    res.json({
      target: target,
      status: 'unknown',
      message: 'Health check simulated',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/myip', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || 
             req.headers['x-real-ip'] || 
             req.connection.remoteAddress;
  
  res.json({
    ip: ip,
    hostname: req.get('host'),
    userAgent: req.get('user-agent'),
    timestamp: new Date().toISOString()
  });
});

// ======================
// HTML GENERATOR
// ======================
function generateHTML(proxies, page, hostname) {
  const totalPages = Math.ceil((cachedProxies.length || 1) / CONFIG.PROXY_PER_PAGE);
  
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${CONFIG.SERVICE_NAME} - Railway</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-white">
<div class="container mx-auto p-4">
    <h1 class="text-3xl font-bold text-center mb-6 text-green-400">🚀 ${CONFIG.SERVICE_NAME}</h1>
    <p class="text-center mb-8">Host: ${hostname} | Proxies: ${cachedProxies.length} | Page: ${page + 1}/${totalPages}</p>
    
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        ${proxies.map(proxy => `
        <div class="bg-gray-800 p-4 rounded-lg">
            <div class="flex justify-between items-center mb-3">
                <h3 class="text-xl font-bold">${proxy.country}</h3>
                <span class="bg-gray-700 px-3 py-1 rounded">${proxy.org}</span>
            </div>
            <p class="text-gray-300 mb-2">IP: ${proxy.ip}:${proxy.port}</p>
            <div class="space-y-2">
                <button onclick="copyConfig('vless://${generateUUID()}@${hostname}:443?type=ws&security=tls&path=/${proxy.ip}-${proxy.port}#${proxy.country}')"
                        class="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded">
                    Copy VLESS TLS
                </button>
                <button onclick="copyConfig('trojan://${generateUUID()}@${hostname}:443?type=ws&security=tls&path=/${proxy.ip}-${proxy.port}#${proxy.country}')"
                        class="w-full bg-purple-600 hover:bg-purple-700 py-2 rounded">
                    Copy Trojan TLS
                </button>
            </div>
        </div>
        `).join('')}
    </div>
    
    <div class="flex justify-center space-x-4 mb-8">
        ${page > 0 ? `<a href="/sub/${page - 1}" class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded">← Previous</a>` : ''}
        ${page < totalPages - 1 ? `<a href="/sub/${page + 1}" class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded">Next →</a>` : ''}
    </div>
    
    <div class="text-center text-gray-400">
        <p>Powered by Railway • <a href="/api/v1/sub?format=clash" class="text-green-400">Download Clash Config</a></p>
    </div>
</div>

<script>
    async function copyConfig(config) {
        try {
            await navigator.clipboard.writeText(config);
            alert('Config copied to clipboard!');
        } catch (err) {
            prompt('Copy this config:', config);
        }
    }
</script>
</body>
</html>`;
}

// ======================
// START SERVER
// ======================
async function startServer() {
  try {
    // Initial proxy fetch
    await fetchProxyList();
    
    // Start server
    server.listen(CONFIG.PORT, CONFIG.HOST, () => {
      console.log(`✅ Server running on http://${CONFIG.HOST}:${CONFIG.PORT}`);
      console.log(`📡 Health check: http://${CONFIG.HOST}:${CONFIG.PORT}/health`);
      console.log(`🌐 Web interface: http://${CONFIG.HOST}:${CONFIG.PORT}/sub/0`);
      console.log(`🔧 API: http://${CONFIG.HOST}:${CONFIG.PORT}/api/v1/sub`);
    });
    
    // Auto-refresh proxies every 5 minutes
    setInterval(fetchProxyList, CONFIG.CACHE_DURATION);
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start the server
startServer();