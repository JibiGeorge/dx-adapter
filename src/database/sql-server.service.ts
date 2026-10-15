import { Injectable, Logger } from '@nestjs/common';
import sql from 'mssql';
import { TenantDatabaseConfig } from '../tenant/tenant.types';

@Injectable()
export class SqlServerService {
  private readonly logger = new Logger(SqlServerService.name);
  private readonly pools = new Map<string, sql.ConnectionPool>();

  /**
   * Returns a cached ConnectionPool for the tenant's database configuration,
   * creating and connecting a new one if it does not already exist.
   */
  async getPool(dbConfig: TenantDatabaseConfig): Promise<sql.ConnectionPool> {
    const key = `${dbConfig.host}:${dbConfig.port || 1433}:${dbConfig.name}:${dbConfig.user}`;

    const existingPool = this.pools.get(key);
    if (existingPool && existingPool.connected) {
      return existingPool;
    }

    const config: sql.config = {
      user: dbConfig.user,
      password: dbConfig.password,
      server: dbConfig.host,
      port: dbConfig.port ? Number(dbConfig.port) : 1433,
      database: dbConfig.name,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };

    try {
      const pool = new sql.ConnectionPool(config);
      await pool.connect();
      this.pools.set(key, pool);
      return pool;
    } catch (error) {
      this.logger.error(
        `Failed to establish SQL Server connection to ${dbConfig.host}:${dbConfig.name}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const [key, pool] of this.pools.entries()) {
      try {
        await pool.close();
      } catch (err) {
        this.logger.warn(`Error closing SQL Server pool ${key}: ${(err as Error).message}`);
      }
    }
    this.pools.clear();
  }
}
