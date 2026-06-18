import { describe, it, expect } from 'vitest';
import { McpToolExecutor } from '../src/mcp/tool-executor';
import { AiExposureLevel } from '../src/shared/models';

describe('McpToolExecutor timeout', () => {
  it('throws on timeout', async () => {
    // Use a non-routable IP to guarantee timeout
    const executor = new McpToolExecutor('http://192.0.2.1:1', undefined, 500);

    const descriptor = {
      toolName: 'slow_tool',
      httpMethod: 'GET',
      route: '/slow',
      contextPriority: 0,
      exposureLevel: AiExposureLevel.Executable,
    };

    await expect(executor.execute(descriptor)).rejects.toThrow(/timed out|Failed to execute/);
  }, 5000);
});
