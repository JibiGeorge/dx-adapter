import { Global, Module } from '@nestjs/common';
import { HttpService } from './http.service.js';
import { LoggingModule } from '../logging/logging.module.js';

@Global()
@Module({
  imports: [LoggingModule],
  providers: [HttpService],
  exports: [HttpService],
})
export class HttpModule {}
