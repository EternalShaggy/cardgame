import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { LobbyModule } from './lobby/lobby.module';
import { MatchModule } from './match/match.module';
import { MatchmakingModule } from './matchmaking/matchmaking.module';
import { PersistenceModule } from './persistence/persistence.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    PersistenceModule,
    AuthModule,
    LobbyModule,
    MatchModule,
    MatchmakingModule,
    ChatModule,
  ],
})
export class AppModule {}
