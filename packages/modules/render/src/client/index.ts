import each from '@tinkoff/utils/array/each';
import { createElement, StrictMode } from 'react';
import type {
  EXTEND_RENDER,
  REACT_SERVER_RENDER_MODE,
  RENDERER_CALLBACK,
  USE_REACT_STRICT_MODE,
} from '@tramvai/tokens-render';
import type { ExtractDependencyType } from '@tinkoff/dippy';
import { renderReact } from '../react';
import { renderer } from './renderer';

export function rendering({
  logger,
  consumerContext,
  customRender,
  extendRender,
  di,
  useStrictMode,
  rendererCallback,
  renderMode,
}: {
  logger: any;
  consumerContext: any;
  extendRender?: ExtractDependencyType<typeof EXTEND_RENDER>;
  customRender?: any;
  di: any;
  useStrictMode: ExtractDependencyType<typeof USE_REACT_STRICT_MODE>;
  rendererCallback?: ExtractDependencyType<typeof RENDERER_CALLBACK>;
  renderMode?: ExtractDependencyType<typeof REACT_SERVER_RENDER_MODE>;
}) {
  const log = logger('module-render');

  return new Promise<void>((resolve, reject) => {
    let renderResult = renderReact({ di }, consumerContext);

    if (extendRender) {
      each((render) => {
        renderResult = render(renderResult);
      }, extendRender);
    }

    if (customRender) {
      return customRender(renderResult);
    }

    if (useStrictMode) {
      renderResult = createElement(StrictMode, null, renderResult);
    }

    const container = document.querySelector('.application');
    const executeRendererCallbacks = (renderErr?: Error) =>
      rendererCallback?.forEach((cb) => {
        try {
          cb(renderErr);
        } catch (cbError) {
          // eslint-disable-next-line no-console
          console.error(cbError);
        }
      });
    const callback = () => {
      log.debug('App rendering');
      document.querySelector('html').classList.remove('no-js');
      executeRendererCallbacks();
      resolve();
    };
    const params = { element: renderResult, container, callback, log, renderMode };

    try {
      renderer(params);
    } catch (e) {
      executeRendererCallbacks(e);
      reject(e);
    }
  });
}
