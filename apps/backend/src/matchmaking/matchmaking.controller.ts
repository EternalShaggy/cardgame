import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MatchmakingService } from './matchmaking.service';
import { RulesetConfig } from '@wholet/shared';

@Controller('matchmaking')
@UseGuards(JwtAuthGuard)
export class MatchmakingController {
  constructor(private readonly matchmakingService: MatchmakingService) {}

  @Post('enqueue')
  enqueue(
    @Request() req: { user: { id: string } },
    @Body() body: { rulesetConfig?: RulesetConfig; region?: string },
  ) {
    return this.matchmakingService.enqueue(req.user.id, body);
  }

  @Post('cancel')
  cancel(@Request() req: { user: { id: string } }) {
    this.matchmakingService.dequeue(req.user.id);
    return { cancelled: true };
  }

  @Get('status')
  status(@Request() req: { user: { id: string } }) {
    return this.matchmakingService.getQueueStatus(req.user.id);
  }
}
