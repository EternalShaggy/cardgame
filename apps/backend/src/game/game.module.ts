import { Module } from '@nestjs/common';

// The rule engine is a pure function module; no providers needed.
// Import RuleEngine functions directly where needed.
@Module({})
export class GameModule {}
