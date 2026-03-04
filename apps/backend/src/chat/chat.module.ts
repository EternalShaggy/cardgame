import { Module } from '@nestjs/common';

// Chat is handled inline in the WebSocket gateway for in-match chat.
// Lobby chat uses Supabase Realtime Broadcast on the client side.
// This module is a placeholder for future expansion (moderation, history API).
@Module({})
export class ChatModule {}
