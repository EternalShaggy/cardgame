import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PersistenceService } from '../persistence/persistence.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly persistence: PersistenceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const token = authHeader.substring(7);
    const user = await this.persistence.verifyJwt(token);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.user = { id: user.id, email: user.email };
    return true;
  }
}
