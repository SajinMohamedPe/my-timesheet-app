import { HttpErrorResponse, HttpEvent, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { delay, mergeMap } from 'rxjs/operators';
import { MockDb } from '../mock/mock-db';
import { handleMockRequest, ParsedReq } from '../mock/mock-api.handler';

// Single shared store for the whole app session.
const db = new MockDb();

/**
 * Serves every /api/* request from the in-browser mock store.
 * To switch to the real Spring Boot backend: remove this interceptor from
 * app.config.ts and point `environment.apiBase` at the real API.
 */
export const mockApiInterceptor: HttpInterceptorFn = (req, next): Observable<HttpEvent<unknown>> => {
  const url = req.url;
  if (!url.includes('/api/')) return next(req);

  // urlWithParams includes the serialized query string; req.url does NOT.
  const parsed = parse(req.urlWithParams, req.method, req.body, req.headers.get('Authorization'));
  const result = handleMockRequest(db, parsed);

  const latency = 120 + Math.random() * 180;
  return of(null).pipe(
    delay(latency),
    mergeMap(() => {
      if (result.status >= 200 && result.status < 300) {
        return of(new HttpResponse({ status: result.status, body: result.body }));
      }
      return throwError(() => new HttpErrorResponse({
        status: result.status, error: result.body, url,
      }));
    }),
  );
};

function parse(url: string, method: string, body: any, auth: string | null): ParsedReq {
  const u = new URL(url, 'http://localhost');
  const path = u.pathname;
  const segments = path.split('/').filter(Boolean); // ['api','domains',...]
  return { method: method.toUpperCase(), path, segments, query: u.searchParams, body, auth };
}
