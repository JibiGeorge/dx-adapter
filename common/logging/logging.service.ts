import { Injectable, LoggerService, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LOG_LEVELS, LogLevelName } from './logging.constants.js';
import { redact } from './logging-redaction.js';
import { RequestContextService } from './request-context.service.js';

export interface StructuredLogEntry {
  timestamp: string;
  level: string;
  service: string;
  environment: string;
  context?: string;
  message: string;
  requestId?: string;
  traceId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
  };
}

@Injectable()
export class LoggingService implements LoggerService {
  private readonly isProduction: boolean;
  private readonly serviceName: string;
  private readonly environment: string;
  private currentLogLevel: number;

  constructor(
    @Optional()
    private readonly configService?: ConfigService,
    @Optional()
    private readonly requestContext?: RequestContextService,
  ) {
    this.environment =
      this.configService?.get<string>('NODE_ENV') ??
      process.env.NODE_ENV ??
      'development';

    this.isProduction = this.environment.toLowerCase() === 'production';

    this.serviceName =
      this.configService?.get<string>('SERVICE_NAME') ??
      process.env.SERVICE_NAME ??
      'dx-adapter';

    const configuredLevel = (
      this.configService?.get<string>('LOG_LEVEL') ??
      process.env.LOG_LEVEL ??
      (this.isProduction ? 'log' : 'debug')
    ).toLowerCase() as LogLevelName;

    this.currentLogLevel = LOG_LEVELS[configuredLevel] ?? (this.isProduction ? 3 : 4);
  }

  setLogLevel(level: LogLevelName): void {
    if (level in LOG_LEVELS) {
      this.currentLogLevel = LOG_LEVELS[level];
    }
  }

  private isLevelEnabled(level: LogLevelName): boolean {
    const levelPriority = LOG_LEVELS[level];
    return levelPriority !== undefined && levelPriority <= this.currentLogLevel;
  }

  debug(message: any, context?: string, metadata?: Record<string, unknown>): void {
    if (this.isLevelEnabled('debug')) {
      this.writeLog('debug', message, context, metadata);
    }
  }

  log(message: any, context?: string, metadata?: Record<string, unknown>): void {
    if (this.isLevelEnabled('log')) {
      this.writeLog('info', message, context, metadata);
    }
  }

  info(message: any, context?: string, metadata?: Record<string, unknown>): void {
    if (this.isLevelEnabled('info')) {
      this.writeLog('info', message, context, metadata);
    }
  }

  warn(message: any, context?: string, metadata?: Record<string, unknown>): void {
    if (this.isLevelEnabled('warn')) {
      this.writeLog('warn', message, context, metadata);
    }
  }

  verbose(message: any, context?: string, metadata?: Record<string, unknown>): void {
    if (this.isLevelEnabled('verbose')) {
      this.writeLog('verbose', message, context, metadata);
    }
  }

  error(
    message: any,
    stackOrContext?: string,
    contextOrMetadata?: any,
    metadata?: Record<string, unknown>,
  ): void {
    if (!this.isLevelEnabled('error')) {
      return;
    }

    let stack: string | undefined;
    let context: string | undefined;
    let meta: Record<string, unknown> | undefined = metadata;

    if (typeof stackOrContext === 'string' && stackOrContext.includes('\n')) {
      stack = stackOrContext;
      if (typeof contextOrMetadata === 'string') {
        context = contextOrMetadata;
      } else if (typeof contextOrMetadata === 'object') {
        meta = contextOrMetadata;
      }
    } else if (typeof stackOrContext === 'string') {
      context = stackOrContext;
      if (typeof contextOrMetadata === 'object') {
        meta = contextOrMetadata;
      }
    }

    if (message instanceof Error) {
      stack = stack ?? message.stack;
      this.writeLog('error', message.message, context, meta, {
        name: message.name,
        message: message.message,
        stack,
      });
      return;
    }

    this.writeLog('error', message, context, meta, stack ? { stack } : undefined);
  }

  fatal(
    message: any,
    stackOrContext?: string,
    contextOrMetadata?: any,
    metadata?: Record<string, unknown>,
  ): void {
    if (!this.isLevelEnabled('fatal')) {
      return;
    }

    let stack: string | undefined;
    let context: string | undefined;
    let meta: Record<string, unknown> | undefined = metadata;

    if (typeof stackOrContext === 'string' && stackOrContext.includes('\n')) {
      stack = stackOrContext;
      if (typeof contextOrMetadata === 'string') {
        context = contextOrMetadata;
      } else if (typeof contextOrMetadata === 'object') {
        meta = contextOrMetadata;
      }
    } else if (typeof stackOrContext === 'string') {
      context = stackOrContext;
      if (typeof contextOrMetadata === 'object') {
        meta = contextOrMetadata;
      }
    }

    if (message instanceof Error) {
      stack = stack ?? message.stack;
      this.writeLog('fatal', message.message, context, meta, {
        name: message.name,
        message: message.message,
        stack,
      });
      return;
    }

    this.writeLog('fatal', message, context, meta, stack ? { stack } : undefined);
  }

  private writeLog(
    level: string,
    rawMessage: any,
    context?: string,
    metadata?: Record<string, unknown>,
    errorDetails?: { name?: string; message?: string; stack?: string },
  ): void {
    const timestamp = new Date().toISOString();
    const requestId = this.requestContext?.getRequestId();
    const traceId = this.requestContext?.getTraceId();
    const tenantId = this.requestContext?.getTenantId();

    const messageString =
      typeof rawMessage === 'string'
        ? rawMessage
        : typeof rawMessage === 'object' && rawMessage !== null
          ? JSON.stringify(redact(rawMessage))
          : String(rawMessage);

    const redactedMetadata = metadata ? (redact(metadata) as Record<string, unknown>) : undefined;
    const redactedError = errorDetails
      ? {
          name: errorDetails.name,
          message: errorDetails.message ? (redact(errorDetails.message) as string) : undefined,
          stack: errorDetails.stack ? (redact(errorDetails.stack) as string) : undefined,
        }
      : undefined;

    const entry: StructuredLogEntry = {
      timestamp,
      level,
      service: this.serviceName,
      environment: this.environment,
      ...(context ? { context } : {}),
      message: messageString,
      ...(requestId ? { requestId } : {}),
      ...(traceId ? { traceId } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(redactedMetadata && Object.keys(redactedMetadata).length > 0 ? { metadata: redactedMetadata } : {}),
      ...(redactedError ? { error: redactedError } : {}),
    };

    if (this.isProduction) {
      const jsonLine = JSON.stringify(entry) + '\n';
      if (level === 'error' || level === 'fatal') {
        process.stderr.write(jsonLine);
      } else {
        process.stdout.write(jsonLine);
      }
    } else {
      this.writeDevConsole(entry);
    }
  }

  private writeDevConsole(entry: StructuredLogEntry): void {
    const timeFormatted = entry.timestamp.substring(11, 23); // HH:mm:ss.SSS
    const levelTag = entry.level.toUpperCase().padEnd(5);
    const contextTag = entry.context ? `[${entry.context}] ` : '';

    const correlations: string[] = [];
    if (entry.requestId) correlations.push(`req:${entry.requestId.substring(0, 8)}`);
    if (entry.traceId) correlations.push(`trace:${entry.traceId.substring(0, 8)}`);
    if (entry.tenantId) correlations.push(`tenant:${entry.tenantId}`);
    const corrTag = correlations.length > 0 ? ` (${correlations.join('|')})` : '';

    const prefix = `[${timeFormatted}] [${levelTag}] ${contextTag}`;
    const mainLine = `${prefix}${entry.message}${corrTag}`;

    if (entry.level === 'error' || entry.level === 'fatal') {
      console.error(mainLine);
      if (entry.error?.stack) {
        console.error(entry.error.stack);
      }
    } else if (entry.level === 'warn') {
      console.warn(mainLine);
    } else {
      console.log(mainLine);
    }

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      console.log('  Metadata:', JSON.stringify(entry.metadata, null, 2));
    }
  }
}
