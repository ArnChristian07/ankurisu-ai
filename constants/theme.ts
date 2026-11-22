/**
 * HUD palette — holographic cyan with a crimson system accent
 * and nixie-tube amber.
 */
export const HUD = {
  bg: '#04070D',
  bgRaised: '#070D16',
  panel: 'rgba(8, 18, 30, 0.78)',
  panelSolid: '#08121E',
  line: '#123049',
  lineDim: '#0B1D2D',

  holo: '#4FD8FF',
  holoSoft: 'rgba(79, 216, 255, 0.16)',
  holoDim: '#2A86AD',
  holoDeep: '#0F3A52',

  crimson: '#E8344E',
  crimsonSoft: 'rgba(232, 52, 78, 0.14)',
  nixie: '#FF9B3D',

  ok: '#3BE3A4',
  warn: '#FFB547',
  off: '#4A6378',

  text: '#EAF6FF',
  textMuted: '#7F9BB3',
  textDim: '#4A6378',
  onHolo: '#021018',
} as const;

export const MONO = { fontFamily: 'SpaceMono' } as const;
