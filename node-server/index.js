import { WebSocketServer } from "ws";
import { attachRelay } from "./relay.js";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error(
    `Environment variable "OPENAI_API_KEY" is required.\n` +
      `Please set it in your .env file.`
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3000);
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", async (ws, req) => {
  if (!req.url) {
    console.log("No URL provided, closing connection.");
    ws.close();
    return;
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname !== "/") {
    console.log(`Invalid pathname: "${pathname}"`);
    ws.close();
    return;
  }

  const expectedToken = process.env.AGENT_ACCESS_TOKEN;
  const providedToken = url.searchParams.get("token");

  if (!expectedToken || providedToken !== expectedToken) {
    console.log("Unauthorized connection");
    ws.close(1008, "Unauthorized");
    return;
  }

  attachRelay(ws, { apiKey: OPENAI_API_KEY });
});

console.log(`Websocket server listening on port ${PORT}`);
