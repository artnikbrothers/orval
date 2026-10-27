import { bindReporter, isBoolean } from '@orval/core';

import { logger } from '../logger';

/**
 * Start a file watcher and invoke an async callback on file changes.
 *
 * If `watchOptions` is falsy the watcher is not started. Supported shapes:
 *  - boolean: when true the `defaultTarget` is watched
 *  - string: a single path to watch
 *  - string[]: an array of paths to watch
 *
 * @param watchOptions - false to disable watching, or a path/paths to watch
 * @param watchFn - async callback executed on change events
 * @param defaultTarget - path(s) to watch when `watchOptions` is `true` (default: '.')
 * @returns Resolves once the watcher has been started (or immediately if disabled)
 *
 * @example
 * await startWatcher(true, async () => { await buildProject(); }, 'src');
 */
export async function startWatcher(
  watchOptions: boolean | string | string[],
  watchFn: () => Promise<void>,
  defaultTarget: string | string[] = '.',
) {
  if (!watchOptions) return;
  const { watch } = await import('chokidar');
  const restore = bindReporter();

  const ignored = ['**/{.git,node_modules}/**'];

  const watchPaths = isBoolean(watchOptions) ? defaultTarget : watchOptions;

  logger.info(
    `Watching for changes in ${
      Array.isArray(watchPaths)
        ? watchPaths.map((v) => '"' + v + '"').join(' | ')
        : '"' + watchPaths + '"'
    }`,
  );

  // Wait for the file size to settle so a half-written spec is not read.
  const watcher = watch(watchPaths, {
    ignorePermissionErrors: true,
    ignored,
    awaitWriteFinish: { stabilityThreshold: 200 },
  });

  // Runs never overlap; changes that arrive mid-run trigger a single re-run.
  let running = false;
  let rerun = false;
  const run = async (): Promise<void> => {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      await watchFn();
    } catch (error) {
      restore(() => {
        logger.error(error);
      });
    } finally {
      running = false;
    }
    if (rerun) {
      rerun = false;
      await run();
    }
  };

  // Unhandled watcher errors (e.g. stat failures) would otherwise crash the process.
  watcher.on('error', (error) => {
    restore(() => {
      logger.error(error);
    });
  });

  watcher.on('ready', () => {
    restore(() => {
      logger.info('Initial scan complete. Watching for changes...');
      watcher.on('all', (type, file) => {
        restore(() => {
          logger.info(`Change detected: ${type} ${file}`);

          void run();
        });
      });
    });
  });
}
