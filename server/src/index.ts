import express from 'express';
import cors from 'cors';
import { migrate } from './db/client.js';
import { errorHandler } from './lib/errors.js';
import { api } from './routes/api.js';

await migrate();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', api);
app.use(errorHandler);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Tally Cloud API listening on http://localhost:${port}`));
