import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { API_TOKEN } from './tokens.js';

@Injectable()
export class BearerGuard implements CanActivate {
  private readonly expected: Buffer;
  constructor(@Inject(API_TOKEN) token: string) {
    this.expected = Buffer.from('Bearer ' + token);
  }
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    const actual = Buffer.from(request.headers.authorization ?? '');
    if (actual.length !== this.expected.length || !timingSafeEqual(actual, this.expected)) {
      throw new UnauthorizedException('Unauthorized');
    }
    return true;
  }
}

