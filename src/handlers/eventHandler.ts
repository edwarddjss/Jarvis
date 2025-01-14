import { Client } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function loadEvents(client: Client) {
  const eventsPath = join(__dirname, '../events');
  const eventFiles = readdirSync(eventsPath).filter(file => 
    file.endsWith('.ts') || file.endsWith('.js')
  );

  for (const file of eventFiles) {
    const filePath = join(eventsPath, file);
    
    try {
      const eventModule = await import(filePath);
      
      if ('name' in eventModule && 'execute' in eventModule) {
        if (eventModule.once) {
          client.once(eventModule.name, (...args) => eventModule.execute(...args));
        } else {
          client.on(eventModule.name, (...args) => eventModule.execute(...args));
        }
        console.log(`Loaded event: ${file}`);
      } else {
        console.error(`Invalid event structure in file: ${file}`);
      }
    } catch (error) {
      console.error(`Error loading event from file: ${file}`);
      console.error(error);
    }
  }
}