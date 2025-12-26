const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const WebSocket = require('ws');
const { connect } = require('net');
const crypto = require('crypto');
const fetch = require('node-fetch');

// Variables
const rootDomain = "lifetime01.workers.dev"; // Ganti dengan domain utama kalian
const serviceName = "vip"; // Ganti dengan nama workers kalian
const proxyIP = "https://github.com/FoolVPN-ID/Nautica/blob/main/proxyList.txt";
let cachedProxyList = [];

// Constants
const APP_DOMAIN = `${serviceName}.${rootDomain}`;
const PORTS = [443, 80];
const PROTOCOLS = ["trojan", "vless", "ss"];
const KV_PROXY_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/kvProxyList.json";
const PROXY_BANK_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/proxyList.txt";
const DNS_SERVER_ADDRESS = "8.8.8.8";
const DNS_SERVER_PORT = 53;
const PROXY_HEALTH_CHECK_API = "https://id1.foolvpn.me/api/v1/check";
const CONVERTER_URL = "https://api.foolvpn.me/convert";
const DONATE_LINK = "google.com";
const PROXY_PER_PAGE = 24;
const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

async function getKVProxyList(kvProxyUrl = KV_PROXY_URL) {
  if (!kvProxyUrl) throw new Error("No KV Proxy URL Provided!");
  const kvProxy = await fetch(kvProxyUrl);
  return kvProxy.status === 200 ? await kvProxy.json() : {};
}

async function getProxyList(proxyBankUrl = PROXY_BANK_URL) {
  if (!proxyBankUrl) throw new Error("No Proxy Bank URL Provided!");
  const proxyBank = await fetch(proxyBankUrl);
  
  if (proxyBank.status === 200) {
    const text = await proxyBank.text();
    const proxyString = text.split("\n").filter(Boolean);
    cachedProxyList = proxyString.map((entry) => {
      const [proxyIP, proxyPort, country, org] = entry.split(",");
      return {
        proxyIP: proxyIP || "Unknown",
        proxyPort: proxyPort || "Unknown",
        country: country || "Unknown",
        org: org || "Unknown Org",
      };
    }).filter(Boolean);
  }
  return cachedProxyList;
}

function generateUUID() {
  return crypto.randomUUID();
}

function reverse(s) {
  return s.split("").reverse().join("");
}

function getFlagEmoji(isoCode) {
  const codePoints = isoCode.toUpperCase().split("").map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  Object.entries(CORS_HEADER_OPTIONS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  next();
});

// Routes
app.get('/sub/:page?', async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 0;
    const hostname = req.get('host');
    const countrySelect = req.query.cc?.split(',');
    const proxyBankUrl = req.query['proxy-list'] || PROXY_BANK_URL;
    
    let proxyList = (await getProxyList(proxyBankUrl)).filter(proxy => {
      if (countrySelect) return countrySelect.includes(proxy.country);
      return true;
    });

    const configs = generateConfigs(hostname, proxyList, page);
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.send(configs);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.get('/check', async (req, res) => {
  try {
    const target = req.query.target.split(':');
    const result = await checkProxyHealth(target[0], target[1] || '443');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/sub', async (req, res) => {
  try {
    const filterCC = req.query.cc?.split(',') || [];
    const filterPort = req.query.port?.split(',') || PORTS;
    const filterVPN = req.query.vpn?.split(',') || PROTOCOLS;
    const filterLimit = parseInt(req.query.limit) || 10;
    const filterFormat = req.query.format || 'raw';
    const fillerDomain = req.query.domain || APP_DOMAIN;
    const proxyBankUrl = req.query['proxy-list'] || PROXY_BANK_URL;

    let proxyList = await getProxyList(proxyBankUrl);
    if (filterCC.length > 0) {
      proxyList = proxyList.filter(proxy => filterCC.includes(proxy.country));
    }

    // Shuffle
    proxyList.sort(() => Math.random() - 0.5);

    const uuid = generateUUID();
    const result = [];
    for (const proxy of proxyList) {
      if (result.length >= filterLimit) break;
      
      for (const port of filterPort) {
        for (const protocol of filterVPN) {
          if (result.length >= filterLimit) break;
          
          const uri = new URL(`${protocol}://${fillerDomain}`);
          uri.username = protocol === 'ss' ? Buffer.from(`none:${uuid}`).toString('base64') : uuid;
          uri.port = port.toString();
          uri.searchParams.set('encryption', 'none');
          uri.searchParams.set('type', 'ws');
          uri.searchParams.set('host', APP_DOMAIN);
          uri.searchParams.set('security', port === 443 ? 'tls' : 'none');
          uri.searchParams.set('sni', port === 80 && protocol === 'vless' ? '' : APP_DOMAIN);
          uri.searchParams.set('path', `/${proxy.proxyIP}-${proxy.proxyPort}`);
          
          if (protocol === 'ss') {
            uri.searchParams.set('plugin', `v2ray-plugin${port === 80 ? '' : ';tls'};mux=0;mode=websocket;path=/${proxy.proxyIP}-${proxy.proxyPort};host=${APP_DOMAIN}`);
          }
          
          uri.hash = `${result.length + 1} ${getFlagEmoji(proxy.country)} ${proxy.org} WS ${port === 443 ? 'TLS' : 'NTLS'} [${serviceName}]`;
          result.push(uri.toString());
        }
      }
    }

    let finalResult = result.join('\n');
    if (['clash', 'sfa', 'bfr'].includes(filterFormat)) {
      const converterRes = await fetch(CONVERTER_URL, {
        method: 'POST',
        body: JSON.stringify({
          url: result.join(','),
          format: filterFormat,
          template: 'cf',
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      if (converterRes.ok) {
        finalResult = await converterRes.text();
      } else {
        return res.status(converterRes.status).send(converterRes.statusText);
      }
    }

    res.send(finalResult);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.get('/api/v1/myip', (req, res) => {
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip;
  res.json({
    ip,
    colo: req.headers['cf-ray']?.split('-')[1] || 'unknown',
    country: req.headers['cf-ipcountry'] || 'unknown',
    asOrganization: req.headers['cf-ray']?.split('-')[1] || 'unknown'
  });
});

// WebSocket Handler
wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let targetProxy = proxyIP;

  try {
    if (url.pathname.length === 3 || url.pathname.includes(',')) {
      const proxyKeys = url.pathname.replace('/', '').toUpperCase().split(',');
      const proxyKey = proxyKeys[Math.floor(Math.random() * proxyKeys.length)];
      const kvProxy = await getKVProxyList();
      if (kvProxy[proxyKey]) {
        targetProxy = kvProxy[proxyKey][Math.floor(Math.random() * kvProxy[proxyKey].length)];
      }
    } else {
      const match = url.pathname.match(/^\/(.+[:=-]\d+)$/);
      if (match) targetProxy = match[1];
    }

    handleWebSocketConnection(ws, targetProxy);
  } catch (error) {
    ws.close(1011, error.message);
  }
});

// Helper functions
function generateConfigs(hostname, proxyList, page) {
  const startIndex = PROXY_PER_PAGE * page;
  const uuid = generateUUID();
  let html = '<html><head><title>Proxy List</title></head><body>';
  html += `<h1>Total: ${proxyList.length} | Page: ${page}</h1>`;

  for (let i = startIndex; i < startIndex + PROXY_PER_PAGE; i++) {
    const proxy = proxyList[i];
    if (!proxy) break;

    html += `<div style="border:1px solid #ccc;padding:10px;margin:10px">`;
    html += `<h3>${proxy.country} - ${proxy.org}</h3>`;
    html += `<p>IP: ${proxy.proxyIP} | Port: ${proxy.proxyPort}</p>`;

    for (const port of PORTS) {
      for (const protocol of PROTOCOLS) {
        const config = generateConfig(hostname, proxy, uuid, port, protocol);
        html += `<div style="margin:5px 0"><code>${config}</code></div>`;
      }
    }
    html += `</div>`;
  }

  html += '</body></html>';
  return html;
}

function generateConfig(hostname, proxy, uuid, port, protocol) {
  const config = {
    host: hostname,
    port: port,
    uuid: uuid,
    path: `/${proxy.proxyIP}-${proxy.proxyPort}`,
    security: port === 443 ? 'tls' : 'none',
    sni: port === 80 && protocol === 'vless' ? '' : hostname,
    type: 'ws',
    encryption: 'none'
  };

  switch (protocol) {
    case 'vless':
      return `vless://${uuid}@${hostname}:${port}?type=ws&security=${config.security}&path=${config.path}#${proxy.country}`;
    case 'trojan':
      return `trojan://${uuid}@${hostname}:${port}?type=ws&security=${config.security}&path=${config.path}#${proxy.country}`;
    case 'ss':
      const ssUser = Buffer.from(`none:${uuid}`).toString('base64');
      return `ss://${ssUser}@${hostname}:${port}?plugin=v2ray-plugin${port === 80 ? '' : ';tls'}&path=${config.path}#${proxy.country}`;
  }
}

async function checkProxyHealth(ip, port) {
  const res = await fetch(`${PROXY_HEALTH_CHECK_API}?ip=${ip}:${port}`);
  return await res.json();
}

function handleWebSocketConnection(ws, targetProxy) {
  ws.on('message', async (message) => {
    try {
      // Parse protocol and handle connection
      // (Simplified - actual implementation would need full protocol parsing)
      const [host, port] = targetProxy.split(/[:=-]/);
      const socket = connect(parseInt(port) || 443, host);
      
      socket.on('data', (data) => ws.send(data));
      socket.on('error', (err) => ws.close(1011, err.message));
      
      socket.write(message);
      
      ws.on('message', (msg) => socket.write(msg));
      ws.on('close', () => socket.end());
      
    } catch (error) {
      ws.close(1011, error.message);
    }
  });
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
