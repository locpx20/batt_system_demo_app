import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { createApiApp } from './server/app.ts';

async function startServer() {
  const app = createApiApp();
  const port = Number(process.env.PORT || 3000);
  const distPath = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' || (fs.existsSync(distPath) && process.env.USE_DIST === 'true');

  if (!isProd && process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`BATT PPMS server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
