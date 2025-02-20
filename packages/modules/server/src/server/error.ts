import isNil from '@tinkoff/utils/is/nil';
import type { FastifyInstance } from 'fastify';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { parse } from '@tinkoff/url';
import { isNotFoundError, isRedirectFoundError, isHttpError } from '@tinkoff/errors';
import { safeStringify } from '@tramvai/safe-strings';
import type { LOGGER_TOKEN } from '@tramvai/module-common';
import type { FETCH_WEBPACK_STATS_TOKEN } from '@tramvai/tokens-render';
import type {
  WEB_FASTIFY_APP_AFTER_ERROR_TOKEN,
  WEB_FASTIFY_APP_BEFORE_ERROR_TOKEN,
} from '@tramvai/tokens-server-private';
import type { ExtractDependencyType } from '@tinkoff/dippy';
import { ChunkExtractor } from '@loadable/server';

export const errorHandler = (
  app: FastifyInstance,
  {
    log,
    beforeError,
    afterError,
    fetchWebpackStats,
  }: {
    log: ReturnType<typeof LOGGER_TOKEN>;
    beforeError: ExtractDependencyType<typeof WEB_FASTIFY_APP_BEFORE_ERROR_TOKEN>;
    afterError: ExtractDependencyType<typeof WEB_FASTIFY_APP_AFTER_ERROR_TOKEN>;
    fetchWebpackStats: ExtractDependencyType<typeof FETCH_WEBPACK_STATS_TOKEN>;
  }
) => {
  // eslint-disable-next-line max-statements
  app.setErrorHandler(async (error, request, reply) => {
    const runHandlers = async (
      handlers: ExtractDependencyType<typeof WEB_FASTIFY_APP_BEFORE_ERROR_TOKEN>
    ) => {
      if (handlers) {
        for (const handler of handlers) {
          const result = await handler(error, request, reply);

          if (result) {
            return result;
          }
        }
      }
    };

    const beforeErrorResult = await runHandlers(beforeError);

    if (!isNil(beforeErrorResult)) {
      return beforeErrorResult;
    }

    const requestInfo = {
      ip: request.ip,
      requestId: request.headers['x-request-id'],
      url: request.url,
    };
    let RootErrorBoundary = null;

    try {
      // In case of direct `require` by path, e.g.
      // `require(path.resolve(process.cwd(), 'src', 'error.tsx'))` file
      // doesn't include in the bundle, that is why we are using a
      // path alias here along with webpack config option.
      // See usage of `ROOT_ERROR_BOUNDARY_ALIAS`.
      // eslint-disable-next-line import/no-unresolved, import/extensions
      RootErrorBoundary = require('@/__private__/error').default;
    } catch {}

    if (isRedirectFoundError(error)) {
      log.info({
        event: 'redirect-found-error',
        message: `RedirectFoundError, redirect to ${error.nextUrl}, action execution will be aborted.
More information about redirects - https://tramvai.dev/docs/features/routing/redirects`,
        error,
        requestInfo,
      });

      reply.header('cache-control', 'no-store, no-cache, must-revalidate');
      reply.redirect(error.httpStatus || 307, error.nextUrl);
      return;
    }

    let httpStatus: number;
    let logLevel: string;
    let logEvent: string;
    let logMessage: string;

    if (isNotFoundError(error)) {
      httpStatus = error.httpStatus || 404;

      logLevel = 'info';
      logEvent = 'not-found-error';
      logMessage = `NotFoundError, action execution will be aborted.
Not Found page is common use-case with this error - https://tramvai.dev/docs/features/routing/wildcard-routes/#not-found-page`;
    } else if (isHttpError(error)) {
      httpStatus = error.httpStatus || 500;

      if (error.httpStatus >= 500) {
        logLevel = 'error';
        logEvent = 'send-server-error';
        logMessage = `This is expected server error, here is most common cases:
- Router Guard blocked request - https://tramvai.dev/docs/features/routing/hooks-and-guards#guards
- Forced Page Error Boundary render with 5xx code in Guard or Action - https://tramvai.dev/docs/features/error-boundaries#force-render-page-error-boundary-in-action`;
      } else {
        logLevel = 'info';
        logEvent = 'http-error';
        logMessage = `This is expected server error, here is most common cases:
  - Route is not found - https://tramvai.dev/docs/features/routing/flow#server-navigation
  - Forced Page Error Boundary render with 4xx code in Guard or Action - https://tramvai.dev/docs/features/error-boundaries#force-render-page-error-boundary-in-action
  - Request Limiter blocked request with 429 code - https://tramvai.dev/docs/references/modules/request-limiter/`;
      }
    } else {
      httpStatus = error.statusCode || 500;

      if (error.statusCode >= 500) {
        logLevel = 'error';
        logEvent = 'send-server-error';
        logMessage = `This is Fastify 5xx error, you can check ${
          error.code
        } code in https://www.fastify.io/docs/latest/Reference/Errors/#${error.code.toLowerCase()} page`;
      } else if (error.statusCode >= 400) {
        // a lot of noise with FST_ERR_CTP_INVALID_MEDIA_TYPE 4xx logs from Fastify,
        // when somebody tries to scan our site and send some unsupported content types
        logLevel = 'info';
        logEvent = 'fastify-error-4xx';
        logMessage = `This is Fastify 4xx error, you can check ${
          error.code
        } code in https://www.fastify.io/docs/latest/Reference/Errors/#${error.code.toLowerCase()} page`;
      } else {
        logLevel = 'error';
        logEvent = 'send-server-error';
        logMessage = `Unexpected server error. Error cause will be in "error" parameter.
  Most likely an error has occurred in the rendering of the current React page component
  You can try to find relative logs by using "x-request-id" header`;
      }
    }

    logMessage = `${logMessage}
${
  RootErrorBoundary !== null
    ? 'Root Error Boundary will be rendered for the client'
    : 'You can add Error Boundary for better UX - https://tramvai.dev/docs/features/error-boundaries'
}'`;

    log[logLevel]({
      event: logEvent,
      message: logMessage,
      error,
      requestInfo,
    });

    const afterErrorResult = await runHandlers(afterError);

    if (!isNil(afterErrorResult)) {
      return afterErrorResult;
    }

    reply.status(httpStatus);

    if (RootErrorBoundary !== null) {
      try {
        const stats = await fetchWebpackStats();
        const extractor = new ChunkExtractor({ stats, entrypoints: ['rootErrorBoundary'] });
        const url = parse(requestInfo.url);
        const serializedError = {
          status: httpStatus,
          message: error.message,
          stack: error.stack,
        };

        const body = renderToString(
          createElement(RootErrorBoundary, { error: serializedError, url })
        ).replace(
          '</head>',
          [
            '<script>' +
              `window.serverUrl = ${safeStringify(url)};` +
              `window.serverError = new Error(${safeStringify(serializedError.message)});` +
              `Object.assign(window.serverError, ${safeStringify(serializedError)});` +
              '</script>',
            extractor.getStyleTags(),
            extractor.getScriptTags(),
            '</head>',
          ]
            .filter(Boolean)
            .join('\n')
        );

        log.info({
          event: 'render-root-error-boundary',
          message: 'Render Root Error Boundary for the client',
        });

        reply.header('Content-Type', 'text/html; charset=utf-8');
        reply.header('Content-Length', Buffer.byteLength(body, 'utf8'));
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');

        return body;
      } catch (e) {
        log.warn({
          event: 'failed-root-error-boundary',
          message: 'Root Error Boundary rendering failed',
          error: e,
        });
      }
    }

    throw error;
  });
};
