import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LobbyService } from './lobby.service';
import { RulesetConfig } from '@wholet/shared';

@Controller('lobbies')
@UseGuards(JwtAuthGuard)
export class LobbyController {
  constructor(private readonly lobbyService: LobbyService) {}

  @Get()
  listPublicLobbies() {
    return this.lobbyService.listPublicLobbies();
  }

  @Get(':id')
  getLobby(@Param('id') id: string) {
    return this.lobbyService.getLobby(id);
  }

  @Post()
  createLobby(
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      maxPlayers: number;
      isPublic: boolean;
      allowSpectators: boolean;
      rulesetConfig: RulesetConfig;
    },
  ) {
    return this.lobbyService.createLobby(req.user.id, body);
  }

  @Post('join-by-code')
  joinByCode(
    @Request() req: { user: { id: string } },
    @Body() body: { code: string },
  ) {
    return this.lobbyService.joinByCode(req.user.id, body.code);
  }

  @Post(':id/join')
  joinLobby(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { role?: 'player' | 'spectator' },
  ) {
    return this.lobbyService.joinLobby(req.user.id, id, body.role);
  }

  @Post(':id/leave')
  leaveLobby(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.lobbyService.leaveLobby(req.user.id, id);
  }

  @Post(':id/ready')
  setReady(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { isReady: boolean },
  ) {
    return this.lobbyService.setReady(req.user.id, id, body.isReady);
  }

  @Post(':id/kick')
  kickMember(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { targetUserId: string },
  ) {
    return this.lobbyService.kickMember(req.user.id, id, body.targetUserId);
  }

  @Post(':id/start')
  startMatch(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.lobbyService.startMatch(req.user.id, id);
  }

  @Put(':id/ruleset')
  updateRuleset(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { rulesetConfig: RulesetConfig },
  ) {
    return this.lobbyService.updateRuleset(req.user.id, id, body.rulesetConfig);
  }
}
