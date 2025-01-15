import express from 'express';
import { logger } from './config/logger.js';

const app = express();
const port = process.env.PORT || 8080;

app.get('/', (req, res) => {
    res.send('Bot is running!');
});

app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
});
