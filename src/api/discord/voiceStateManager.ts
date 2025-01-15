// src/api/discord/voiceStateManager.ts

import { logger } from '../../config/logger.js';

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
        const previousState = this.getVoiceState(guildId);
        this.guildStates.set(guildId, state);
        logger.info(`Voice state changed for guild ${guildId}: ${previousState} -> ${state}`);
    }

    /**
     * Gets the current voice activity state for a guild
     */
    public getVoiceState(guildId: string): VoiceActivityType {
        const state = this.guildStates.get(guildId) || VoiceActivityType.NONE;
        logger.debug(`Current voice state for guild ${guildId}: ${state}`);
        return state;
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
