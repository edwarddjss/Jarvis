// src/api/discord/voiceStateManager.ts

export enum VoiceActivityType {
    NONE = 'none',
    MUSIC = 'music',
    SPEECH = 'speech'
}

/**
 * Manages the voice state for each guild to prevent conflicts between
 * music playback and AI speech.
 */
export class VoiceStateManager {
    private static instance: VoiceStateManager;
    private guildStates: Map<string, VoiceActivityType>;

    private constructor() {
        this.guildStates = new Map();
    }

    public static getInstance(): VoiceStateManager {
        if (!VoiceStateManager.instance) {
            VoiceStateManager.instance = new VoiceStateManager();
        }
        return VoiceStateManager.instance;
    }

    /**
     * Sets the voice activity state for a guild
     */
    public setVoiceState(guildId: string, state: VoiceActivityType): void {
        this.guildStates.set(guildId, state);
    }

    /**
     * Gets the current voice activity state for a guild
     */
    public getVoiceState(guildId: string): VoiceActivityType {
        return this.guildStates.get(guildId) || VoiceActivityType.NONE;
    }

    /**
     * Checks if the guild is currently playing music
     */
    public isPlayingMusic(guildId: string): boolean {
        return this.getVoiceState(guildId) === VoiceActivityType.MUSIC;
    }

    /**
     * Checks if the guild is currently using AI speech
     */
    public isSpeaking(guildId: string): boolean {
        return this.getVoiceState(guildId) === VoiceActivityType.SPEECH;
    }

    /**
     * Clears the voice state for a guild
     */
    public clearState(guildId: string): void {
        this.guildStates.set(guildId, VoiceActivityType.NONE);
    }
}
