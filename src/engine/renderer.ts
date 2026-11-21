import { Canvas2DAsciiRenderer } from './canvas2dRenderer';
import type { ActiveBackend, GridBuffer, RendererMode } from './types';
import { WebGL2AsciiRenderer } from './webgl2Renderer';

export interface AsciiRenderer {
  readonly backend: ActiveBackend;
  resize(width: number, height: number, dpr: number, fontSize: number): void;
  render(grid: GridBuffer): void;
  dispose(): void;
}

export function createAsciiRenderer(
  canvas: HTMLCanvasElement,
  mode: RendererMode
): AsciiRenderer {
  if (mode === 'auto' || mode === 'webgl2') {
    const webgl = WebGL2AsciiRenderer.tryCreate(canvas);
    if (webgl) {
      return webgl;
    }
  }
  return new Canvas2DAsciiRenderer(canvas);
}
