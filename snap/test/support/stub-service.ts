// Test-only execution service: the standard Node worker-thread service, with the network stub loaded first.
import { ThreadParentMessageStream } from '@metamask/post-message-stream/node';
import { NodeThreadExecutionService } from '@metamask/snaps-controllers/node';
import { resolve } from 'path';
import { Worker } from 'worker_threads';

const STUB = resolve(__dirname, 'mock-fetch.js');
const ENVIRONMENT = require.resolve('@metamask/snaps-execution-environments/node-thread');

export class StubbedNetworkExecutionService extends NodeThreadExecutionService {
  protected async initEnvStream(snapId: string) {
    this.setSnapStatus(snapId, 'initializing');
    const worker = new Worker(`require(${JSON.stringify(STUB)}); require(${JSON.stringify(ENVIRONMENT)});`, {
      eval: true,
      stdout: true,
      stderr: true,
    });
    worker.stdout.on('data', () => undefined);
    worker.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      if (!/ExperimentalWarning|--trace-warnings/u.test(text)) {
        console.error(text);
      }
    });
    const stream = new ThreadParentMessageStream({ thread: worker });
    return { worker, stream };
  }
}
