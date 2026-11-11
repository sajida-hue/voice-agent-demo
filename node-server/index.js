import 'dotenv/config';
import { createApplication } from './server.js';

try {
  const { server } = createApplication({
    apiKey: process.env.OPENAI_API_KEY,
    password: process.env.APP_PASSWORD,
    publicOrigin: process.env.PUBLIC_ORIGIN,
    model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || 'ch9J8IB6HKlEHQaWQFdk',
    elevenlabsModel: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
  });
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => console.log(`Sajida server listening on port ${port}`));
} catch {
  console.error('Startup failed. Check OPENAI_API_KEY, APP_PASSWORD (at least 16 characters), and PUBLIC_ORIGIN.');
  process.exitCode = 1;
}

