import { jest, describe, beforeEach, test, expect } from '@jest/globals';

// ─── In-process SagaState store ──────────────────────────────────────────────
const mockStates = new Map();

const makeSagaDoc = (data) => {
  const doc = {
    sagaId: data.sagaId,
    type: data.type,
    status: data.status ?? 'pending',
    completedSteps: [...(data.completedSteps ?? [])],
    failedStep: data.failedStep ?? null,
    retryCount: data.retryCount ?? 0,
    metadata: { ...(data.metadata ?? {}) },
  };
  doc.save = jest.fn(async function () {
    mockStates.set(doc.sagaId, { ...doc });
    return doc;
  });
  return doc;
};

// ─── Mongoose mock ────────────────────────────────────────────────────────────
jest.unstable_mockModule('mongoose', () => ({
  default: {
    startSession: jest.fn(async () => ({
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(async () => {}),
      abortTransaction: jest.fn(async () => {}),
      endSession: jest.fn(),
    })),
  },
}));

// ─── SagaState model mock ─────────────────────────────────────────────────────
jest.unstable_mockModule('../src/models/SagaState.model.js', () => ({
  default: {
    findOne: jest.fn(async ({ sagaId } = {}) => {
      const stored = mockStates.get(sagaId);
      if (!stored) return null;
      return makeSagaDoc(stored);
    }),
    findOneAndUpdate = jest.fn(async ({ sagaId }, update) => {
      const stored = mockStates.get(sagaId);
      if (stored && update.$set) {
        Object.assign(stored, update.$set);
        mockStates.set(sagaId, stored);
      }
      return stored ? makeSagaDoc(stored) : null;
    }),
    create: jest.fn(async (data) => {
      const doc = makeSagaDoc(data);
      mockStates.set(doc.sagaId, { ...doc });
      return doc;
    }),
    updateOne: jest.fn(async ({ sagaId }, update) => {
      const stored = mockStates.get(sagaId);
      if (stored && update.$set) {
        // handle nested dotted keys like 'metadata.recovered'
        for (const [key, val] of Object.entries(update.$set)) {
          if (key.includes('.')) {
            const [parent, child] = key.split('.');
            stored[parent] = { ...(stored[parent] ?? {}), [child]: val };
          } else {
            stored[key] = val;
          }
        }
        mockStates.set(sagaId, stored);
      }
      return { matchedCount: stored ? 1 : 0 };
    }),
    deleteMany: jest.fn(async () => {
      mockStates.clear();
    }),
  },
}));

// ─── devLogger mock ───────────────────────────────────────────────────────────
jest.unstable_mockModule('../src/utils/devLogger.js', () => ({
  devLog: jest.fn(),
}));

// ─── Dynamic imports (after mocks) ───────────────────────────────────────────
const { default: SagaOrchestrator } = await import('../src/services/saga/sagaOrchestrator.js');
const { default: SagaState } = await import('../src/models/SagaState.model.js');

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Saga Orchestrator Framework', () => {
  beforeEach(async () => {
    await SagaState.deleteMany({});
    jest.clearAllMocks();

    // Re-wire findOne/create/updateOne after clearAllMocks
    SagaState.findOne.mockImplementation(async ({ sagaId } = {}) => {
      const stored = mockStates.get(sagaId);
      if (!stored) return null;
      return makeSagaDoc(stored);
    });
    SagaState.findOneAndUpdate.mockImplementation(async ({ sagaId }, update) => {
      const stored = mockStates.get(sagaId);
      if (stored && update.$set) {
        Object.assign(stored, update.$set);
        mockStates.set(sagaId, stored);
      }
      return stored ? makeSagaDoc(stored) : null;
    });
    SagaState.create.mockImplementation(async (data) => {
      const doc = makeSagaDoc(data);
      mockStates.set(doc.sagaId, { ...doc });
      return doc;
    });
    SagaState.updateOne.mockImplementation(async ({ sagaId }, update) => {
      const stored = mockStates.get(sagaId);
      if (stored && update.$set) {
        for (const [key, val] of Object.entries(update.$set)) {
          if (key.includes('.')) {
            const [parent, child] = key.split('.');
            stored[parent] = { ...(stored[parent] ?? {}), [child]: val };
          } else {
            stored[key] = val;
          }
        }
        mockStates.set(sagaId, stored);
      }
      return { matchedCount: stored ? 1 : 0 };
    });
    SagaState.deleteMany.mockImplementation(async () => {
      mockStates.clear();
    });
  });

  // ── 1. Successful execution ─────────────────────────────────────────────────
  test('executes all forward steps and marks saga completed', async () => {
    const sagaId = 'saga-success';
    const log = [];

    const steps = [
      {
        name: 'step1',
        execute: async (ctx) => { log.push('step1'); ctx.v1 = 'a'; },
        compensate: async () => { log.push('comp1'); },
      },
      {
        name: 'step2',
        execute: async (ctx) => { log.push('step2'); ctx.v2 = 'b'; },
        compensate: async () => { log.push('comp2'); },
      },
    ];

    const result = await SagaOrchestrator.executeSaga(sagaId, 'TEST', steps, { seed: 1 });

    expect(result.seed).toBe(1);
    expect(result.v1).toBe('a');
    expect(result.v2).toBe('b');
    expect(log).toEqual(['step1', 'step2']);

    const state = await SagaState.findOne({ sagaId });
    expect(state.status).toBe('completed');
    expect(state.completedSteps).toEqual(['step1', 'step2']);
    expect(state.failedStep).toBeNull();
  });

  // ── 2. Rollback execution ───────────────────────────────────────────────────
  test('compensates completed steps in reverse order when a step fails', async () => {
    const sagaId = 'saga-rollback';
    const log = [];

    const steps = [
      {
        name: 'step1',
        execute: async () => { log.push('step1'); },
        compensate: async () => { log.push('comp1'); },
      },
      {
        name: 'step2',
        execute: async () => {
          log.push('step2-fail');
          throw new Error('boom');
        },
        compensate: async () => { log.push('comp2'); },
      },
    ];

    await expect(
      SagaOrchestrator.executeSaga(sagaId, 'TEST', steps, {}, { maxRetries: 1 })
    ).rejects.toThrow('boom');

    // step2 never completed → only step1 compensated
    expect(log).toEqual(['step1', 'step2-fail', 'comp1']);

    const state = await SagaState.findOne({ sagaId });
    expect(state.status).toBe('rolled_back');
    expect(state.completedSteps).toEqual(['step1']);
    expect(state.failedStep).toBe('step2');
  });

  // ── 3. Retry behaviour ──────────────────────────────────────────────────────
  test('retries a failing step and succeeds on 3rd attempt', async () => {
    const sagaId = 'saga-retry';
    let attempts = 0;

    const steps = [
      {
        name: 'flaky',
        execute: async (ctx) => {
          attempts += 1;
          if (attempts < 3) throw new Error('transient');
          ctx.done = true;
        },
        compensate: async () => {},
      },
    ];

    const result = await SagaOrchestrator.executeSaga(
      sagaId, 'TEST', steps, {}, { maxRetries: 3, retryDelayMs: 5 }
    );

    expect(result.done).toBe(true);
    expect(attempts).toBe(3);

    const state = await SagaState.findOne({ sagaId });
    expect(state.status).toBe('completed');
    expect(state.retryCount).toBe(2);
  });

  // ── 4. Idempotency protection ───────────────────────────────────────────────
  test('returns cached metadata on duplicate sagaId without re-executing steps', async () => {
    const sagaId = 'saga-idempotent';
    let execCount = 0;

    const steps = [
      {
        name: 'step1',
        execute: async (ctx) => {
          execCount += 1;
          ctx.token = 'original';
        },
        compensate: async () => {},
      },
    ];

    // First run
    const r1 = await SagaOrchestrator.executeSaga(sagaId, 'TEST', steps);
    expect(r1.token).toBe('original');

    // Swap implementation — should NOT be called
    steps[0].execute = async (ctx) => {
      execCount += 1;
      ctx.token = 'replacement';
    };

    // Second run with same sagaId
    const r2 = await SagaOrchestrator.executeSaga(sagaId, 'TEST', steps);
    expect(r2.token).toBe('original');   // cached result returned
    expect(execCount).toBe(1);            // step executed only once
  });

  // ── 5. Failed-step recovery ─────────────────────────────────────────────────
  test('resumes from failed step, skipping already-completed steps', async () => {
    const sagaId = 'saga-resume';
    const log = [];

    const steps = [
      {
        name: 'step1',
        execute: async () => { log.push('step1'); },
        compensate: async () => {},
      },
      {
        name: 'step2',
        execute: async (ctx) => {
          if (!ctx.recovered) throw new Error('not yet');
          log.push('step2');
        },
        compensate: async () => {},
      },
    ];

    // Pre-seed a failed state with step1 already done
    await SagaState.create({
      sagaId,
      type: 'TEST',
      status: 'failed',
      completedSteps: ['step1'],
      failedStep: 'step2',
      metadata: { recovered: false },
    });

    // Patch the stored metadata so step2 will succeed this time
    await SagaState.updateOne(
      { sagaId },
      { $set: { status: 'failed', 'metadata.recovered': true } }
    );

    const result = await SagaOrchestrator.executeSaga(
      sagaId, 'TEST', steps, {}, { maxRetries: 1 }
    );

    // step1 was in completedSteps → skipped; only step2 runs
    expect(log).toEqual(['step2']);
    expect(result.recovered).toBe(true);

    const state = await SagaState.findOne({ sagaId });
    expect(state.status).toBe('completed');
    expect(state.completedSteps).toEqual(['step1', 'step2']);
  });

  // ── 6. Stale processing → reclaimed and retried ─────────────────────────────
  test('reclaims a stale processing saga and completes the retry', async () => {
    const sagaId = 'saga-stale-reclaim';
    const log = [];

    const steps = [
      {
        name: 'step1',
        execute: async () => { log.push('step1'); },
        compensate: async () => {},
      },
      {
        name: 'step2',
        execute: async () => { log.push('step2'); },
        compensate: async () => {},
      },
    ];

    // Simulate a crashed saga: status=processing, step1 done, lastHeartbeatAt is ancient
    const staleTimestamp = new Date(Date.now() - 60_000); // 60 s ago — well past any threshold
    await SagaState.create({
      sagaId,
      type: 'TEST',
      status: 'processing',
      completedSteps: ['step1'],
      failedStep: null,
      metadata: {},
      lastHeartbeatAt: staleTimestamp,
    });

    // Retry with staleThresholdMs = 30 000 ms — 60 s old heartbeat is stale
    const result = await SagaOrchestrator.executeSaga(
      sagaId, 'TEST', steps, {}, { maxRetries: 1, staleThresholdMs: 30_000, heartbeatIntervalMs: 999_999 }
    );

    // step1 was already in completedSteps → skipped; only step2 re-runs
    expect(log).toEqual(['step2']);

    const state = await SagaState.findOne({ sagaId });
    expect(state.status).toBe('completed');
    expect(state.completedSteps).toEqual(['step1', 'step2']);
    // result should carry original context
    expect(result).toBeDefined();
  });

  // ── 7. Live processing saga still blocked ───────────────────────────────────
  test('still throws for a processing saga with a recent heartbeat', async () => {
    const sagaId = 'saga-live-block';

    // Simulate a live saga: lastHeartbeatAt is just now
    await SagaState.create({
      sagaId,
      type: 'TEST',
      status: 'processing',
      completedSteps: [],
      failedStep: null,
      metadata: {},
      lastHeartbeatAt: new Date(), // fresh
    });

    const steps = [
      {
        name: 'step1',
        execute: async () => {},
        compensate: async () => {},
      },
    ];

    // staleThresholdMs = 30 000 ms; heartbeat is < 1 s old → not stale → must throw
    await expect(
      SagaOrchestrator.executeSaga(
        sagaId, 'TEST', steps, {}, { staleThresholdMs: 30_000, heartbeatIntervalMs: 999_999 }
      )
    ).rejects.toThrow(/currently in progress/);

    // Verify the state was NOT mutated
    const state = await SagaState.findOne({ sagaId });
    expect(state.status).toBe('processing');
  });

  // ── 8. Mid-crash retry: same idempotency key completes after simulated crash ─
  test('client retry after simulated mid-flight crash completes the merge saga', async () => {
    const sagaId = 'saga-crash-retry';
    const log = [];

    const steps = [
      {
        name: 'gitMerge',
        execute: async (ctx) => { log.push('gitMerge'); ctx.merged = true; },
        compensate: async () => { log.push('undoMerge'); },
      },
      {
        name: 'updatePR',
        execute: async (ctx) => { log.push('updatePR'); ctx.prClosed = true; },
        compensate: async () => {},
      },
    ];

    // First attempt: process crashes after gitMerge completes but before updatePR —
    // seed the DB as the crash left it.
    const staleTimestamp = new Date(Date.now() - 45_000);
    await SagaState.create({
      sagaId,
      type: 'MERGE_PULL_REQUEST',
      status: 'processing',
      completedSteps: ['gitMerge'],
      failedStep: null,
      metadata: { prId: 'pr-abc' },
      lastHeartbeatAt: staleTimestamp,
    });

    // Client retries with the same Idempotency-Key after server restart.
    const result = await SagaOrchestrator.executeSaga(
      sagaId, 'MERGE_PULL_REQUEST', steps, { prId: 'pr-abc' },
      { maxRetries: 1, staleThresholdMs: 30_000, heartbeatIntervalMs: 999_999 }
    );

    // gitMerge already in completedSteps → skipped; only updatePR runs
    expect(log).toEqual(['updatePR']);
    expect(result.merged).toBe(true);
    expect(result.prClosed).toBe(true);

    const state = await SagaState.findOne({ sagaId });
    expect(state.status).toBe('completed');
    expect(state.completedSteps).toEqual(['gitMerge', 'updatePR']);
  });
});
