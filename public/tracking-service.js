(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createTrackingService: factory };
  }
  if (root) root.ASATrackingService = factory();
})(typeof window !== 'undefined' ? window : null, function createTrackingService(options) {
  'use strict';

  options = options || {};
  const requestFrame = options.requestFrame || (callback => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame || (handle => cancelAnimationFrame(handle));
  const processors = new Map();
  let source = null;
  let running = false;
  let frameHandle = null;
  let frameNumber = 0;

  function schedule() {
    if (running && frameHandle === null) frameHandle = requestFrame(processFrame);
  }

  function processFrame(timestamp) {
    frameHandle = null;
    if (!running) return;

    frameNumber += 1;
    if (source && source.readyState >= 2) {
      for (const processor of processors.values()) {
        if (processor.busy || frameNumber % processor.everyNFrames !== 0) continue;
        processor.busy = true;

        let result;
        try {
          result = processor.process(source, timestamp);
        } catch (error) {
          processor.busy = false;
          processor.onError?.(error);
          continue;
        }

        Promise.resolve(result).then(
          value => processor.onResult?.(value, timestamp),
          error => processor.onError?.(error)
        ).finally(() => {
          processor.busy = false;
        });
      }
    }

    schedule();
  }

  return Object.freeze({
    registerProcessor(id, definition) {
      if (typeof id !== 'string' || !id || processors.has(id)) {
        throw new Error(`Tracking processor '${id}' is already registered or invalid`);
      }
      if (!definition || typeof definition.process !== 'function') {
        throw new TypeError('Tracking processor requires a process function');
      }

      const everyNFrames = Math.max(1, Math.floor(Number(definition.everyNFrames) || 1));
      processors.set(id, {
        process: definition.process,
        onResult: typeof definition.onResult === 'function' ? definition.onResult : null,
        onError: typeof definition.onError === 'function' ? definition.onError : null,
        onStop: typeof definition.onStop === 'function' ? definition.onStop : null,
        everyNFrames,
        busy: false
      });

      return () => processors.delete(id);
    },

    start(nextSource) {
      if (!nextSource) throw new TypeError('Tracking requires a video source');
      source = nextSource;
      if (running) return;
      running = true;
      schedule();
    },

    stop() {
      const wasRunning = running;
      running = false;
      source = null;
      if (frameHandle !== null) cancelFrame(frameHandle);
      frameHandle = null;
      if (wasRunning) {
        for (const processor of processors.values()) {
          try {
            processor.onStop?.();
          } catch (error) {
            processor.onError?.(error);
          }
        }
      }
    },

    getDiagnostics() {
      return {
        running,
        frameNumber,
        processorCount: processors.size,
        sourceAttached: source !== null
      };
    }
  });
});
