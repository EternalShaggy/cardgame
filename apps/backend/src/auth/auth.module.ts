import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TicketService } from './ticket.service';

@Module({
  controllers: [AuthController],
  providers: [JwtAuthGuard, TicketService],
  exports: [JwtAuthGuard, TicketService],
})
export class AuthModule {}
