import { EnergyArc } from '../../src/types';

export function buildEnergyCurve(arc: EnergyArc, durationMinutes: number): number[] {
  const curve: number[] = [];
  for (let i = 0; i < durationMinutes; i++) {
    const t = i / (durationMinutes - 1 || 1);
    switch (arc) {
      case 'build':
        // Sigmoid from 0.4 to 0.9
        curve.push(0.4 + 0.5 / (1 + Math.exp(-10 * (t - 0.5))));
        break;
      case 'peak':
        // Constant 0.85-0.95 with variation
        curve.push(0.85 + 0.1 * Math.sin(t * Math.PI * 4) * 0.5 + 0.05);
        break;
      case 'cool-down':
        // Reverse sigmoid
        curve.push(0.9 - 0.5 / (1 + Math.exp(-10 * (t - 0.5))));
        break;
      case 'wave':
        // Sinusoidal centered on 0.7
        curve.push(0.7 + 0.2 * Math.sin(t * Math.PI * (durationMinutes / 20)));
        break;
      default:
        curve.push(0.7);
    }
  }
  return curve;
}
