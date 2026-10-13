import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Prevent MIME-sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Clickjacking defense
    res.setHeader('X-Frame-Options', 'DENY');

    // Disable legacy browser XSS auditor to avoid auditor vulnerabilities
    res.setHeader('X-XSS-Protection', '0');

    // Enforce HTTPS transmission
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // Restrict resource loading & prevent framing
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none';",
    );

    // Cross-origin isolation
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // Minimize referrer leakage
    res.setHeader('Referrer-Policy', 'no-referrer');

    // Restrict access to sensitive browser device features
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
    );

    // Remove fingerprinting header
    res.removeHeader('X-Powered-By');

    next();
  }
}
