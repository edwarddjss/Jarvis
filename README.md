# Jarvis Discord Bot

A Discord bot that enables voice interaction with LLMs and provides music playback functionality.

## Features

- Voice interaction with LLMs through ElevenLabs
- Music playback from YouTube, Spotify, and SoundCloud
- Voice commands and text commands support
- Queue management and music controls

## Setup

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

Required environment variables:
- `DISCORD_BOT_TOKEN`: Your Discord bot token
- `DISCORD_CLIENT_ID`: Your Discord application client ID
- `SPOTIFY_CLIENT_ID`: (Optional) Spotify API client ID
- `SPOTIFY_CLIENT_SECRET`: (Optional) Spotify API client secret
- `SPOTIFY_REFRESH_TOKEN`: (Optional) Spotify refresh token
- `SOUNDCLOUD_CLIENT_ID`: (Optional) SoundCloud client ID
- `AGENT_ID`: Your ElevenLabs agent ID
- `DEBUG`: Set to 'true' for debug logging

4. Deploy commands:
```bash
npx ts-node src/deploy-commands.ts
```

5. Start the bot:
```bash
npm start
```

## Development

- Run in development mode:
```bash
npm run dev
```

- Format code:
```bash
npm run format:fix
```

- Lint code:
```bash
npm run lint:fix
```

## License

MIT
