import { LoggingService } from "./logging.service";
import { RequestContextService } from "./request-context.service";

describe('LoggingService', () => {
  let service: LoggingService;
  let contextService: RequestContextService;

  beforeEach(() => {
    contextService = new RequestContextService();
    service = new LoggingService(undefined, contextService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should write log without throwing when context is missing', () => {
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    expect(() => service.log('hello', 'TestCtx')).not.toThrow();
    stdoutSpy.mockRestore();
  });

  it('should write error to stderr in production mode', () => {
    process.env.NODE_ENV = 'production';
    const prodService = new LoggingService(undefined, contextService);
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);

    prodService.error('boom', 'SomeStack\nat line 1', 'TestCtx');

    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(written.trim());
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('boom');
    stderrSpy.mockRestore();
    delete process.env.NODE_ENV;
  });

  it('should produce structured JSON with expected fields in production', () => {
    process.env.NODE_ENV = 'production';
    const prodService = new LoggingService(undefined, contextService);

    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    prodService.log('test message', 'Context');
    expect(stdoutSpy).toHaveBeenCalled();

    const written = stdoutSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(written.trim());

    expect(entry).toMatchObject({
      level: 'info',
      service: expect.any(String),
      environment: 'production',
      message: 'test message',
      context: 'Context',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });

    stdoutSpy.mockRestore();
    delete process.env.NODE_ENV;
  });

  it('should NOT emit debug logs below configured level', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'log';
    const prodService = new LoggingService(undefined, contextService);
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockReturnValue(true);

    prodService.debug('should be silent');

    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
  });

  it('should redact sensitive metadata keys', () => {
    process.env.NODE_ENV = 'production';
    const prodService = new LoggingService(undefined, contextService);
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockReturnValue(true);

    prodService.log('sensitive test', 'Context', {
      normalField: 'ok',
      password: 'super-secret',
      authorization: 'Bearer token123',
    });

    const written = stdoutSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(written.trim());

    expect(entry.metadata.normalField).toBe('ok');
    expect(entry.metadata.password).toBe('[REDACTED]');
    expect(entry.metadata.authorization).toBe('[REDACTED]');

    stdoutSpy.mockRestore();
    delete process.env.NODE_ENV;
  });

  it('should handle Error objects in error()', () => {
    process.env.NODE_ENV = 'production';
    const prodService = new LoggingService(undefined, contextService);
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);

    const err = new Error('something went wrong');
    prodService.error(err, err.stack, 'TestCtx');

    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
    delete process.env.NODE_ENV;
  });
});
