import type { Provider } from '@tinkoff/dippy';
import { provide } from '@tinkoff/dippy';
import { CLOSE_HANDLER_TOKEN, INIT_HANDLER_TOKEN } from '../../tokens';
import {
  CONFIG_MANAGER_TOKEN,
  CONFIG_ENTRY_TOKEN,
  COMMAND_PARAMETERS_TOKEN,
  STATIC_SERVER_TOKEN,
  PORT_MANAGER_TOKEN,
} from '../../../../di/tokens';
import type { ChildAppConfigEntry } from '../../../../typings/configEntry/child-app';
import { stopServer } from '../../utils/stopServer';
import { createServer } from '../../utils/createServer';
import { listenServer } from '../../utils/listenServer';
import { createConfigManager } from '../../../../config/configManager';

export const sharedProviders: readonly Provider[] = [
  provide({
    provide: CONFIG_MANAGER_TOKEN,
    useFactory: ({ configEntry, parameters, portManager }) =>
      createConfigManager(configEntry as ChildAppConfigEntry, {
        ...parameters,
        appEnv: parameters.env,
        env: 'development',
        port: portManager.port,
      }),
    deps: {
      configEntry: CONFIG_ENTRY_TOKEN,
      parameters: COMMAND_PARAMETERS_TOKEN,
      portManager: PORT_MANAGER_TOKEN,
    },
  }),
  provide({
    provide: STATIC_SERVER_TOKEN,
    useFactory: createServer,
  }),
  provide({
    provide: INIT_HANDLER_TOKEN,
    multi: true,
    useFactory: ({ staticServer, configManager }) => {
      return async function staticServerListen() {
        const { host, port } = configManager;

        await listenServer(staticServer, host, port);
      };
    },
    deps: {
      staticServer: STATIC_SERVER_TOKEN,
      configManager: CONFIG_MANAGER_TOKEN,
    },
  }),
  provide({
    provide: CLOSE_HANDLER_TOKEN,
    multi: true,
    useFactory: ({ staticServer }) => {
      return () => {
        return stopServer(staticServer);
      };
    },
    deps: {
      staticServer: STATIC_SERVER_TOKEN,
    },
  }),
] as const;
