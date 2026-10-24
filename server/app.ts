import express from 'express';
import { getDb, getUploadsDir } from './db.ts';
import { authAndUsersRouter } from './routes/authAndUsers.ts';
import { partnersAndPurchasingRouter } from './routes/partnersAndPurchasing.ts';
import { productionAndQcRouter } from './routes/productionAndQc.ts';
import { outboundAndMaintenanceRouter } from './routes/outboundAndMaintenance.ts';
import { financeReportsUploadsRouter } from './routes/financeReportsUploads.ts';

export function createApiApp() {
  getDb();
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  app.use('/uploads', express.static(getUploadsDir()));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', authAndUsersRouter);
  app.use('/api', partnersAndPurchasingRouter);
  app.use('/api', productionAndQcRouter);
  app.use('/api', outboundAndMaintenanceRouter);
  app.use('/api', financeReportsUploadsRouter);

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Không tìm thấy đường dẫn API yêu cầu.' });
  });

  return app;
}
