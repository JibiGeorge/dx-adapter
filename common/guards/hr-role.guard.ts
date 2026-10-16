import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedRequest } from './jwt-auth.guard.js';

@Injectable()
export class HRRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User session not found.');
    }

    const isCorpHR = Boolean(user.roles?.isCorpHR);

    if (!isCorpHR) {
      throw new ForbiddenException(
        'Access denied: You do not have permissions to access HR resources.',
      );
    }

    return true;
  }
}
