import { noopReporter, type OrvalReporter, withReporter } from '@orval/core';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const watcherMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const watcher = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return watcher;
    }),
  };

  return {
    handlers,
    watch: vi.fn(() => watcher),
  };
});

vi.mock('chokidar', () => ({
  watch: watcherMock.watch,
}));

import { startWatcher } from './watcher';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

const createDeferred = (): Deferred => {
  let resolve: () => void = () => {
    throw new Error('deferred resolved before creation');
  };
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const start = async (watchFn: () => Promise<void>, reporter = noopReporter) => {
  await withReporter(reporter, () => startWatcher(true, watchFn, 'spec.yaml'));
  watcherMock.handlers.get('ready')?.();
  const emit = () => watcherMock.handlers.get('all')?.('change', 'spec.yaml');
  return emit;
};

describe('startWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watcherMock.handlers.clear();
  });

  it('waits for writes to finish before emitting events', async () => {
    await start(vi.fn().mockResolvedValue(undefined));

    expect(watcherMock.watch).toHaveBeenCalledWith(
      'spec.yaml',
      expect.objectContaining({
        awaitWriteFinish: { stabilityThreshold: 200 },
      }),
    );
  });

  it('logs watcher errors instead of crashing', async () => {
    const error = vi.fn();
    const reporter: OrvalReporter = { ...noopReporter, error };
    await start(vi.fn().mockResolvedValue(undefined), reporter);

    watcherMock.handlers.get('error')?.(new Error('stat failed'));

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        // oxlint-disable-next-line typescript/no-unsafe-assignment
        message: expect.stringContaining('stat failed'),
      }),
    );
  });

  it('does not start a watcher when watching is disabled', async () => {
    await startWatcher(false, vi.fn().mockResolvedValue(undefined));

    expect(watcherMock.watch).not.toHaveBeenCalled();
  });

  it('does not run concurrently and re-runs once after events during a run', async () => {
    const first = createDeferred();
    const watchFn = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const emit = await start(watchFn);

    emit();
    await flush();
    expect(watchFn).toHaveBeenCalledTimes(1);

    emit();
    emit();
    emit();
    await flush();
    expect(watchFn).toHaveBeenCalledTimes(1);

    first.resolve();
    await flush();
    expect(watchFn).toHaveBeenCalledTimes(2);

    await flush();
    expect(watchFn).toHaveBeenCalledTimes(2);
  });

  it('runs again for an event after a run has finished', async () => {
    const watchFn = vi.fn().mockResolvedValue(undefined);
    const emit = await start(watchFn);

    emit();
    await flush();
    emit();
    await flush();

    expect(watchFn).toHaveBeenCalledTimes(2);
  });

  it('logs failures and keeps handling later events', async () => {
    const error = vi.fn();
    const reporter: OrvalReporter = { ...noopReporter, error };
    const watchFn = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('run failed'))
      .mockResolvedValue(undefined);
    const emit = await start(watchFn, reporter);

    emit();
    await flush();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        // oxlint-disable-next-line typescript/no-unsafe-assignment
        message: expect.stringContaining('run failed'),
      }),
    );

    emit();
    await flush();
    expect(watchFn).toHaveBeenCalledTimes(2);
  });
});
