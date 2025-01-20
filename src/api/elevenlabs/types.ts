export interface AudioEvent {
  type: 'audio';
  audio_event: {
    audio_base_64: string;
    event_id: number;
  };
}

export interface UserTranscriptEvent {
  type: 'user_transcript';
  user_transcription_event: {
    user_transcript: string;
    confidence_score?: number;
    is_final?: boolean;
  };
}

export interface AgentResponseEvent {
  type: 'agent_response';
  agent_response_event: {
    agent_response: string;
    confidence_score?: number;
    response_id?: string;
  };
}

export interface InterruptionEvent {
  type: 'interruption';
  interruption_event: {
    event_id: number;
  };
}

export interface PingEvent {
  type: 'ping';
  ping_event: {
    event_id: number;
    ping_ms: number;
  };
}

export interface ConversationInitiationMetadata {
  type: 'conversation_initiation_metadata';
  conversation_initiation_metadata_event: {
    conversation_id: string;
    agent_output_audio_format: string;
    agent_language?: string;
    user_language?: string;
  };
}

export interface ConversationEndEvent {
  type: 'conversation_end';
  conversation_end_event: {
    conversation_id: string;
    reason: string;
  };
}

export interface ErrorEvent {
  type: 'error';
  error_event: {
    error_code: string;
    error_message: string;
  };
}

export type ElevenLabsEvent = 
  | AudioEvent 
  | UserTranscriptEvent 
  | AgentResponseEvent 
  | InterruptionEvent 
  | PingEvent 
  | ConversationInitiationMetadata
  | ConversationEndEvent
  | ErrorEvent;