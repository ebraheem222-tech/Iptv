import { createApp } from "./app.js";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be between 1 and 65535.");
const server = createApp().listen(port, host, () => {
  console.log(`Nova TV is ready at http://localhost:${port}`);
  console.log(
    "For a television, use this computer's LAN IP address and the same port.",
  );
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
