// Stand-in for next/server in unit tests: after() callbacks are collected so a test decides when
// the "background" work runs (__after.flush()).
export const __after = {
  queue: [],
  async flush() {
    while (this.queue.length) await this.queue.shift()()
  },
}
export function after(fn) { __after.queue.push(fn) }
export class NextResponse {}
