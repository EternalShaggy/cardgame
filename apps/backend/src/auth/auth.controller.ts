import {
  Controller,
  Post,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TicketService } from './ticket.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly ticketService: TicketService) {}

  /**
   * POST /auth/ws-ticket
   * Requires Bearer JWT. Returns a short-lived (30s) one-time ticket
   * that the client uses to authenticate the WebSocket upgrade.
   */
  @Post('ws-ticket')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  generateWsTicket(@Request() req: { user: { id: string } }) {
    const ticket = this.ticketService.createTicket(req.user.id);
    return {
      ticket: ticket.token,
      expiresAt: ticket.expiresAt,
      userId: req.user.id,
    };
  }
}
