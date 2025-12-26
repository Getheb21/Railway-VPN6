// Deno server
Deno.serve({ port: 3000, hostname: "0.0.0.0" }, (req) => {
  const url = new URL(req.url);
  
  if (url.pathname === "/" || url.pathname === "/health") {
    return new Response(JSON.stringify({
      status: "ok",
      service: "railway-vpn-deno",
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  
  return new Response("Not found", { status: 404 });
});

console.log("🚀 Deno server running on http://0.0.0.0:3000");
