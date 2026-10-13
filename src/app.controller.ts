import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  constructor() {}

  @Get('healthCheck')
  getHealthCheck() {
    return {
      "message": "Health check passed!",
    }
  }
}
