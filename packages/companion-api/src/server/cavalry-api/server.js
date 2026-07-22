import http from 'node:http';

import { createCavalryApiController } from '../../application/api/cavalry-api-controller.js';
import { createCavalryApiRequestHandler } from './routes.js';
import {
  assertCompanionRuntimeCanStart,
  getCompanionApiRuntimeConfig,
  getCompanionRuntimeStatus
} from './runtime.js';

export function isCavalryApiServerEnabled(options = {}) {
  return getCompanionApiRuntimeConfig(options).enabled;
}

export function resolveCavalryApiHost(options = {}) {
  return assertCompanionRuntimeCanStart(getCompanionApiRuntimeConfig(options)).bindHost;
}

export function createCavalryApiServer(options = {}) {
  const runtimeConfig =
    options.runtimeConfig ||
    getCompanionApiRuntimeConfig(
      Object.assign(
        {
          enabled: options.enabled,
          mode: options.mode,
          publicBaseUrl: options.publicBaseUrl,
          allowPrivateBaseUrl: options.allowPrivateBaseUrl,
          authRequired: options.authRequired
        },
        options
      )
    );
  const controller =
    options.controller ||
    createCavalryApiController(
      Object.assign({}, options, {
        runtimeStatus: getCompanionRuntimeStatus(runtimeConfig)
      })
    );
  const handler = createCavalryApiRequestHandler({
    controller,
    authOptions: Object.assign({ runtimeConfig }, options.authOptions || {}),
    routeOptions: {
      maxBodyBytes: options.maxBodyBytes
    }
  });
  return http.createServer(handler);
}

export function startCavalryApiServer(options = {}) {
  const runtimeConfig = assertCompanionRuntimeCanStart(
    options.runtimeConfig || getCompanionApiRuntimeConfig(options)
  );
  const server = createCavalryApiServer(Object.assign({}, options, { runtimeConfig }));
  const port = runtimeConfig.bindPort;
  const host = runtimeConfig.bindHost;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      if (options.quiet !== true) {
        console.warn(
          'Cavalry Companion API enabled in ' +
            runtimeConfig.mode +
            ' mode at http://' +
            host +
            ':' +
            String(port) +
            '. External callers can create drafts only.'
        );
        if (runtimeConfig.mode === 'beta_tunnel') {
          console.warn(
            'Beta tunnel mode is active. Keep auth enabled and use a test workbook first.'
          );
        }
      }
      resolve({
        server,
        url: 'http://' + host + ':' + String(port),
        runtime: runtimeConfig,
        status: getCompanionRuntimeStatus(runtimeConfig)
      });
    });
  });
}
