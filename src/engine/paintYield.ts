// Yields to the browser so it can paint pending DOM updates (e.g. a loading
// bar) before the caller resumes blocking the main thread. A single rAF fires
// before paint, so we wait two frames to guarantee a paint opportunity. Falls
// back to a timer when frames are throttled (hidden/background tab) so renderer
// startup never stalls waiting on rAF.
export function paintYield(): Promise<void> {
  if (typeof requestAnimationFrame === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    // Safety net: paused rAF in a background tab must not block startup.
    setTimeout(finish, 64);
  });
}
