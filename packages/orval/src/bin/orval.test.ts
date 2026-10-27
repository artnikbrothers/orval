import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  generateSpec: vi.fn(),
  startWatcher: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), error: mocks.loggerError },
}));

// The CLI registers options on the shared `program`; give each import a fresh one.
vi.mock('@commander-js/extra-typings', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@commander-js/extra-typings')>();
  return {
    ...actual,
    get program() {
      return new actual.Command();
    },
  };
});

vi.mock('../generate-spec', () => ({
  generateSpec: mocks.generateSpec,
}));

vi.mock('../utils/watcher', () => ({
  startWatcher: mocks.startWatcher,
}));

vi.mock('../utils/options', () => ({
  normalizeOptions: vi.fn().mockResolvedValue({
    input: { target: 'spec.yaml' },
  }),
}));

const runCli = async (...args: string[]) => {
  const argv = process.argv;
  process.argv = ['node', 'orval', ...args];
  try {
    vi.resetModules();
    await import('./orval');
  } finally {
    process.argv = argv;
  }
};

const getWatchCallback = () => {
  const [, callback] = mocks.startWatcher.mock.calls[0] as [
    unknown,
    () => Promise<void>,
  ];
  return callback;
};

describe('orval cli - flag mode watch', () => {
  beforeEach(() => {
    mocks.generateSpec.mockReset();
    mocks.startWatcher.mockReset();
    mocks.loggerError.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits when the initial generation fails', async () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    mocks.generateSpec.mockRejectedValueOnce(new Error('initial failure'));

    await runCli('--input', 'spec.yaml', '--output', 'out.ts');

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('keeps watching when generation fails on a change', async () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    mocks.generateSpec.mockResolvedValueOnce(undefined);

    await runCli('--input', 'spec.yaml', '--output', 'out.ts', '--watch');
    expect(mocks.startWatcher).toHaveBeenCalledTimes(1);

    mocks.generateSpec.mockRejectedValueOnce(new Error('watch failure'));
    await expect(getWatchCallback()()).resolves.toBeUndefined();

    expect(exit).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'watch failure' }),
    );
  });
});
