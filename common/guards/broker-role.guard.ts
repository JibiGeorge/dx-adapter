import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedRequest } from './jwt-auth.guard.js';

@Injectable()
export class BrokerRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User session not found.');
    }

    const isBroker = Boolean(user.roles?.isBroker || user.activePortal === 'broker' || user.brokerId);

    if (!isBroker) {
      throw new ForbiddenException(
        'Access denied: You do not have permissions to access Broker resources.',
      );
    }

    return true;
  }
}
