"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var HttpExceptionFilter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
let HttpExceptionFilter = HttpExceptionFilter_1 = class HttpExceptionFilter {
    logger = new common_1.Logger(HttpExceptionFilter_1.name);
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        let status = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        let errorCode = 'INTERNAL_SERVER_ERROR';
        let message = 'An unexpected error occurred';
        if (exception instanceof common_1.HttpException) {
            status = exception.getStatus();
            const exceptionResponse = exception.getResponse();
            if (typeof exceptionResponse === 'string') {
                message = exceptionResponse;
                errorCode = this.statusToCode(status);
            }
            else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
                const errorResponse = exceptionResponse;
                if (Array.isArray(errorResponse.message)) {
                    message = errorResponse.message.join('; ');
                }
                else if (typeof errorResponse.message === 'string') {
                    message = errorResponse.message;
                }
                errorCode = errorResponse.error?.toUpperCase().replace(/ /g, '_') ?? this.statusToCode(status);
            }
        }
        else if (exception?.success === false && exception?.error) {
            status = exception.statusCode || common_1.HttpStatus.BAD_REQUEST;
            if (exception.error.code === 'UNAUTHORIZED')
                status = common_1.HttpStatus.UNAUTHORIZED;
            else if (exception.error.code === 'NOT_FOUND')
                status = common_1.HttpStatus.NOT_FOUND;
            else if (exception.error.code === 'FORBIDDEN')
                status = common_1.HttpStatus.FORBIDDEN;
            errorCode = exception.error.code;
            message = exception.error.message;
        }
        else {
            this.logger.error('Unhandled exception', exception);
        }
        response.status(status).json({
            success: false,
            error: {
                code: errorCode,
                message,
            }
        });
    }
    statusToCode(status) {
        const map = {
            400: 'BAD_REQUEST',
            401: 'UNAUTHORIZED',
            403: 'FORBIDDEN',
            404: 'NOT_FOUND',
            409: 'CONFLICT',
            422: 'UNPROCESSABLE_ENTITY',
            500: 'INTERNAL_SERVER_ERROR',
        };
        return map[status] ?? 'ERROR';
    }
};
exports.HttpExceptionFilter = HttpExceptionFilter;
exports.HttpExceptionFilter = HttpExceptionFilter = HttpExceptionFilter_1 = __decorate([
    (0, common_1.Catch)()
], HttpExceptionFilter);
//# sourceMappingURL=http-exception.filter.js.map