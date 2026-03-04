import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

interface Ticket {
  token: string;
  userId: string;
  expiresAt: number;
}

@Injectable()
export class TicketService {
  // In-memory for MVP; replace with Redis for multi-instance
  private readonly tickets = new Map<string, Ticket>();
  private readonly TICKET_TTL_MS = 30_000; // 30 seconds

  createTicket(userId: string): Ticket {
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.TICKET_TTL_MS;
    const ticket: Ticket = { token, userId, expiresAt };
    this.tickets.set(token, ticket);
    // Auto-cleanup
    setTimeout(() => this.tickets.delete(token), this.TICKET_TTL_MS);
    return ticket;
  }

  validateAndConsume(token: string): string | null {
    const ticket = this.tickets.get(token);
    if (!ticket) return null;
    if (Date.now() > ticket.expiresAt) {
      this.tickets.delete(token);
      return null;
    }
    this.tickets.delete(token); // one-time use
    return ticket.userId;
  }
}
