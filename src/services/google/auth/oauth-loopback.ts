// ============================================================================
// Google Auth - Loopback OAuth Helper
// ============================================================================

import http from "http";

export interface LoopbackOAuthFlowOptions {
  openUrl: (url: string) => void;
  buildAuthUrl: (redirectUri: string) => string;
  timeoutMs?: number;
}

export interface LoopbackOAuthFlowResult {
  code: string;
  redirectUri: string;
}

export async function runLoopbackOAuthCodeFlow(
  options: LoopbackOAuthFlowOptions
): Promise<LoopbackOAuthFlowResult> {
  const server = http.createServer();

  const codePromise = new Promise<LoopbackOAuthFlowResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("OAuth timeout"));
    }, options.timeoutMs ?? 3 * 60_000);

    server.on("request", (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const code = url.searchParams.get("code");
        const err = url.searchParams.get("error");

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");

        if (err) {
          res.end(`<h3>Authorization failed</h3><p>${err}</p><p>You may close this window.</p>`);
          clearTimeout(timeout);
          reject(new Error(String(err)));
          return;
        }

        if (!code) {
          res.end("<p>Waiting for authorization…</p>");
          return;
        }

        res.end("<h3>Connected.</h3><p>You may close this window and return to Obsidian.</p>");

        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

        clearTimeout(timeout);
        resolve({ code, redirectUri });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

  options.openUrl(options.buildAuthUrl(redirectUri));

  try {
    return await codePromise;
  } finally {
    server.close();
  }
}
