import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.API_KEY = 'test-key-e2e';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.API_KEY;
  });

  it('/healthCheck (GET) - should be publicly accessible without API key', () => {
    return request(app.getHttpServer())
      .get('/api/healthCheck')
      .expect(200)
      .expect({ message: 'Health check passed!' });
  });

  it('/healthCheck (GET) - should include X-Request-Id in response headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/healthCheck')
      .expect(200);

    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('/healthCheck (GET) - should accept and reflect a valid external request ID', async () => {
    const externalId = 'external-req-abc-123';
    const response = await request(app.getHttpServer())
      .get('/api/healthCheck')
      .set('x-request-id', externalId)
      .expect(200);

    expect(response.headers['x-request-id']).toBe(externalId);
  });

  it('/tenant/:id/config (GET) - should reject request without API key', () => {
    return request(app.getHttpServer())
      .get('/api/tenant/some-id/config')
      .expect(401)
      .expect((res) => {
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toMatch(/UNAUTHORIZED/);
      });
  });

  it('/tenant/:id/config (GET) - should include requestId in 401 error response', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/tenant/some-id/config')
      .expect(401);

    expect(response.body.error.requestId).toBeDefined();
  });

  it('/tenant/:id/config (GET) - should reject invalid API key', () => {
    return request(app.getHttpServer())
      .get('/api/tenant/some-id/config')
      .set('x-api-key', 'wrong-key')
      .expect(401)
      .expect((res) => {
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).not.toContain('super-secret');
      });
  });

  it('/tenant/:id/config (GET) - should not expose stack trace or internal details', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/tenant/nonexistent-tenant/config')
      .set('x-api-key', 'test-key-e2e')
      .expect(404);

    const bodyStr = JSON.stringify(response.body);
    expect(bodyStr).not.toContain('utils/config.json');
    expect(bodyStr).not.toContain('node_modules');
    expect(bodyStr).not.toContain('at TenantService');
  });
});
