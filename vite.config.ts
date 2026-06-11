import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

// Dev-only middleware that serves the /api/* functions the same way Vercel does
// in production (each api/<route>.ts file with a default export handler).
function localApiRoutes() {
  return {
    name: "local-api-routes",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const reqUrl = req.url || "/";
        const url = new URL(reqUrl, "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();

        const routeName = url.pathname.replace(/^\/api\//, "");
        const filePath = path.resolve(process.cwd(), "api", `${routeName}.ts`);
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end(`API route not found: ${url.pathname}`);
          return;
        }

        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        req.on("end", async () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            let body: unknown = {};
            if (raw) {
              const ct = String(req.headers["content-type"] || "");
              body = ct.includes("application/json") ? JSON.parse(raw) : raw;
            }
            const query: Record<string, string> = {};
            for (const [k, v] of url.searchParams.entries()) query[k] = v;

            let statusCode = 200;
            const headers: Record<string, string> = {};
            const responseLike = {
              status(code: number) { statusCode = code; return responseLike; },
              setHeader(n: string, v: string) { headers[n] = v; return responseLike; },
              send(payload: unknown) {
                res.statusCode = statusCode;
                Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
                if (typeof payload === "string" || Buffer.isBuffer(payload)) res.end(payload);
                else { if (!headers["Content-Type"]) res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(payload)); }
              },
              end(payload?: unknown) {
                res.statusCode = statusCode;
                Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
                if (payload === undefined) res.end();
                else res.end(typeof payload === "string" || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
              },
            };

            const mod = await server.ssrLoadModule(filePath);
            if (typeof mod.default !== "function") {
              res.statusCode = 500;
              res.end(`Invalid API handler for ${url.pathname}`);
              return;
            }
            await mod.default({ method: req.method, url: reqUrl, headers: req.headers, body, query }, responseLike);
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Local API error" }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: "/",
  build: { outDir: "dist" },
  server: { port: 8090, host: true },
  preview: { port: 8090, host: true },
  plugins: [react(), localApiRoutes()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
