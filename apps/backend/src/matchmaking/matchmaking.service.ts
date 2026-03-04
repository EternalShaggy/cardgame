/**
 * Simple in-process matchmaking queue.
 * For production: replace with a persistent queue (Redis/Postgres-backed).
 */

import { Injectable, Logger } from '@nestjs/common';
import { PersistenceService } from '../persistence/persistence.service';
import { LobbyService } from '../lobby/lobby.service';
import { RulesetConfig, DEFAULT_RULESET } from '@wholet/shared';

interface QueueEntry {
  userId: string;
  rulesetConfig: RulesetConfig;
  region: string;
  enqueuedAt: number;
}

@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);
  private readonly queue: QueueEntry[] = [];
  private readonly MIN_PLAYERS = 2;
  private readonly MAX_WAIT_MS = 30_000; // 30s before starting with fewer players

  constructor(
    private readonly persistence: PersistenceService,
    private readonly lobbyService: LobbyService,
  ) {
    // Check queue every 2 seconds
    setInterval(() => this.processQueue(), 2_000);
  }

  async enqueue(
    userId: string,
    opts: { rulesetConfig?: RulesetConfig; region?: string },
  ): Promise<void> {
    // Remove any existing entry
    this.dequeue(userId);

    const entry: QueueEntry = {
      userId,
      rulesetConfig: opts.rulesetConfig ?? DEFAULT_RULESET,
      region: opts.region ?? 'global',
      enqueuedAt: Date.now(),
    };

    this.queue.push(entry);
    this.logger.log(`User ${userId} enqueued (queue size: ${this.queue.length})`);

    // Persist to DB for observability
    await this.persistence.db.from('matchmaking_queue').upsert({
      user_id: userId,
      ruleset_config: entry.rulesetConfig,
      region: entry.region,
    });
  }

  dequeue(userId: string): void {
    const idx = this.queue.findIndex((e) => e.userId === userId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      this.logger.log(`User ${userId} dequeued`);
    }

    this.persistence.db
      .from('matchmaking_queue')
      .delete()
      .eq('user_id', userId)
      .then(() => {});
  }

  private async processQueue() {
    if (this.queue.length < this.MIN_PLAYERS) return;

    // Simple FIFO grouping: take first 4 players who share ruleset+region
    // In production: implement ELO-based matching
    const candidates = this.queue.slice(0, 4);

    // Group by region (simplified)
    const byRegion = new Map<string, QueueEntry[]>();
    for (const e of candidates) {
      const key = e.region;
      if (!byRegion.has(key)) byRegion.set(key, []);
      byRegion.get(key)!.push(e);
    }

    for (const [region, group] of byRegion) {
      if (group.length < this.MIN_PLAYERS) continue;

      const toMatch = group.slice(0, 4); // max 4 for quick play

      // Create a private lobby and start the match
      try {
        const host = toMatch[0]!;
        const lobby = await this.lobbyService.createLobby(host.userId, {
          maxPlayers: toMatch.length,
          isPublic: false,
          allowSpectators: false,
          rulesetConfig: host.rulesetConfig,
        });

        for (const entry of toMatch.slice(1)) {
          await this.lobbyService.joinLobby(entry.userId, lobby.id);
        }

        // Mark all ready
        for (const entry of toMatch) {
          await this.lobbyService.setReady(entry.userId, lobby.id, true);
        }

        await this.lobbyService.startMatch(host.userId, lobby.id);

        // Remove from queue
        for (const entry of toMatch) {
          this.dequeue(entry.userId);
        }

        this.logger.log(`Match created for ${toMatch.length} players from ${region}`);
      } catch (err) {
        this.logger.error('Matchmaking error:', err);
      }
    }
  }

  getQueueStatus(userId: string): { inQueue: boolean; position: number; queueSize: number } {
    const idx = this.queue.findIndex((e) => e.userId === userId);
    return {
      inQueue: idx !== -1,
      position: idx + 1,
      queueSize: this.queue.length,
    };
  }
}
