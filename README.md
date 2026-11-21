# ASCII Bubbles

Pantalla de carga interactiva hecha completamente con caracteres ASCII clásicos, física de pompas de jabón en tiempo real e iridiscencia óptica por interferencia de película delgada.

## Características

- **Física realista en paso fijo (`120Hz`) con interpolación**: flotación orgánica en microgravedad, rebote elástico con deformación (*squash & wobble*), choques fuertes que hacen estallar la burbuja más frágil (o ambas en impactos extremos) y onda expansiva sobre burbujas vecinas.
- **Interacción mouse y táctil**:
  - Click / toque en una burbuja → explota desde el punto de impacto con anillo de ruptura (`* + x ~`) y gotículas iridiscentes (`* -> + -> : -> . -> '`).
  - Mover el cursor / dedo → corriente de aire proporcional a tu velocidad para empujar y hacer chocar burbujas.
  - Click en espacio vacío → sopla una nueva burbuja.
- **Alto rendimiento (60Hz hasta 240Hz+)**: renderizador **WebGL2 instanciado** (1 *draw call* por frame sobre atlas de glifos *JetBrains Mono*) con **fallback automático a Canvas 2D** y escalado adaptativo opcional.
- **Personalización en vivo (`[cfg]` o tecla `F`)**:
  - 5 estilos ASCII para las burbujas (**Realista**, **Original**, **Cristalino**, **Denso**, **Orgánico**) + slider de deformación.
  - 6 fondos ASCII de baja opacidad (**Atmósfera**, **Corrientes**, **Neblina**, **Rejilla**, **Bruma**, **Negro**) + slider de opacidad.
  - Selector de densidad de grilla (`9px`–`22px`), motor de renderizado (`Auto / WebGL2 / Canvas 2D`), cantidad de burbujas y telemetría de FPS/ms.
- **Audio procedural (Web Audio API)**: efecto de *pop* sin archivos externos cuyo tono varía según el tamaño de la burbuja, silenciable desde `[snd:on/off]`.

## Desarrollo local

```bash
pnpm install
pnpm dev
```

## Scripts

```bash
pnpm test    # Tests unitarios (Vitest)
pnpm build   # Type-check + build de producción (dist/)
pnpm preview # Previsualización del build de producción
```

## Uso como componente React

```tsx
import { AsciiBubbleLoader } from './components/AsciiBubbleLoader';

export function LoadingScreen() {
  return <AsciiBubbleLoader label="cargando..." progress={65} />;
}
```
