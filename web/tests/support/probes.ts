// Sondes injectées avant les scripts de la page (identiques pour les deux interfaces) :
// - latence : t0 = speech_stopped reçu, t1 = premier output_audio.delta qui suit,
//   t2 = premier AudioBufferSourceNode.start qui suit (stratégie de tests, 7) ;
// - ressources : AudioContext et WebSocket créés et encore ouverts, contextes WebGL.
import type { Page } from "@playwright/test";

export type Latency = { endToEnd: number; client: number };

export type Resources = {
  audioContexts: number;
  openSockets: number;
  socketsCreated: number;
  webglContexts: number;
};

export async function installProbes(page: Page) {
  await page.addInitScript(() => {
    type Probe = {
      latencies: { endToEnd: number; client: number }[];
      contexts: AudioContext[];
      sockets: WebSocket[];
      webgl: WebGLRenderingContext[];
      t0?: number;
      t1?: number;
    };
    const probe: Probe = {
      latencies: [],
      contexts: [],
      sockets: [],
      webgl: [],
    };
    (window as unknown as { __probe: Probe }).__probe = probe;

    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        probe.sockets.push(this);
        this.addEventListener("message", (event) => {
          if (typeof event.data !== "string" || !event.data.includes('"type"'))
            return;
          const type = (JSON.parse(event.data) as { type?: string }).type;
          if (type === "input_audio_buffer.speech_stopped") {
            probe.t0 = performance.now();
            probe.t1 = undefined;
          } else if (
            type === "response.output_audio.delta" &&
            probe.t0 !== undefined &&
            probe.t1 === undefined
          ) {
            probe.t1 = performance.now();
          }
        });
      }
    };

    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        probe.contexts.push(this);
      }
    };

    const nativeStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (
      ...args: Parameters<AudioBufferSourceNode["start"]>
    ) {
      if (probe.t0 !== undefined && probe.t1 !== undefined) {
        const t2 = performance.now();
        probe.latencies.push({
          endToEnd: t2 - probe.t0,
          client: t2 - probe.t1,
        });
        probe.t0 = undefined;
        probe.t1 = undefined;
      }
      return nativeStart.apply(this, args);
    };

    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      const context = (nativeGetContext as (...a: unknown[]) => unknown).call(
        this,
        type,
        ...rest,
      );
      if (context && (type === "webgl" || type === "webgl2")) {
        if (!probe.webgl.includes(context as WebGLRenderingContext))
          probe.webgl.push(context as WebGLRenderingContext);
      }
      return context;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

export async function latencies(page: Page): Promise<Latency[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __probe: { latencies: Latency[] } }).__probe
        .latencies,
  );
}

export async function resources(page: Page): Promise<Resources> {
  return page.evaluate(() => {
    const probe = (
      window as unknown as {
        __probe: {
          contexts: AudioContext[];
          sockets: WebSocket[];
          webgl: WebGLRenderingContext[];
        };
      }
    ).__probe;
    return {
      audioContexts: probe.contexts.filter((c) => c.state !== "closed").length,
      openSockets: probe.sockets.filter((s) => s.readyState <= WebSocket.OPEN)
        .length,
      socketsCreated: probe.sockets.length,
      webglContexts: probe.webgl.filter((g) => !g.isContextLost()).length,
    };
  });
}
