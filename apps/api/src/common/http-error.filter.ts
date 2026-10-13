import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{ status: (status: number) => { json: (body: unknown) => void } }>();
    if (error instanceof HttpException) {
      const body = error.getResponse();
      if (typeof body === 'object' && body !== null && 'status' in body && body.status === 'unavailable') {
        response.status(error.getStatus()).json(body);
      } else {
        response.status(error.getStatus()).json({ error: error.message });
      }
      return;
    }
    this.logger.error(error instanceof Error ? error.stack : 'Unknown request error');
    response.status(500).json({ error: 'Internal server error' });
  }
}
