import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';

@Controller()
export class AppController {
  constructor() {}

  @Public()
  @Get('healthCheck')
  getHealthCheck() {
    return {
      message: 'Health check passed!',
    };
  }
}

