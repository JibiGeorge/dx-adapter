import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenantCheck } from '../common/decorators/skip-tenant-check.decorator';

@Controller()
export class AppController {
  constructor() {}

  @Public()
  @SkipTenantCheck()
  @Get('healthCheck')
  getHealthCheck() {
    return {
      message: 'Health check passed!',
    };
  }
}

