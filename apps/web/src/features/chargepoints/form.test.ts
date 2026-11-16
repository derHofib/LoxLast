import { describe, expect, it } from 'vitest';
import { sampleProject } from '../../test-fixtures';
import { commonValue, groupPath, parseField, softWarnings } from './form';

describe('Formular-Logik', () => {
  it('validiert mit Meldung am Feld', () => {
    expect(parseField('ip', '300.1.1.1')).toMatchObject({ ok: false });
    expect(parseField('ip', '10.0.0.5')).toEqual({
      ok: true,
      patch: { network: { ip: '10.0.0.5' } },
    });
    expect(parseField('port', '0')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Port'),
    });
    expect(parseField('unitId', '')).toEqual({
      ok: true,
      patch: { network: { unitId: undefined } },
    });
    expect(parseField('unitId', '300')).toMatchObject({ ok: false });
    expect(parseField('minA', 'abc')).toMatchObject({ ok: false });
    expect(parseField('minA', '6,5')).toEqual({ ok: true, patch: { minA: 6.5 } });
    expect(parseField('fuseA', '0')).toMatchObject({ ok: false });
    expect(parseField('label', ' ')).toMatchObject({ ok: false });
    expect(parseField('label', 'lp02', ['LP02'])).toMatchObject({ ok: false });
    expect(parseField('room', '')).toEqual({ ok: true, patch: { room: undefined } });
    expect(parseField('notes', 'x'.repeat(5001))).toMatchObject({ ok: false });
  });

  it('gemeinsame und abweichende Werte', () => {
    const p = sampleProject();
    expect(commonValue(p.chargePoints.slice(0, 2), 'minA')).toEqual({ value: '6', mixed: false });
    expect(commonValue(p.chargePoints.slice(0, 2), 'phaseRotation')).toEqual({
      value: '',
      mixed: true,
    });
    expect(commonValue(p.chargePoints.slice(0, 2), 'unitId').value).toBe('1');
  });

  it('Gruppenpfad und weiche Hinweise', () => {
    const p = sampleProject();
    expect(groupPath(p, p.groups[0]!.id)).toBe('UV-TG1 › Mieter');
    const cp = p.chargePoints[0]!;
    cp.minA = 4;
    cp.network.ip = p.chargePoints[1]!.network.ip;
    const w = softWarnings(p, [cp]);
    expect(w.minA).toContain('6 A');
    expect(w.ip).toContain('LP02');
  });
});
