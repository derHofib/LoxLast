import { SITE_LEVEL_ID } from '../../calc/analysis';
import type { NetworkEndpoint } from '../../model';
import { finding, type Rule } from '../types';

/**
 * DUP_IP: gleiche Kombination aus IP, Port und Unit-ID mehrfach vergeben.
 * Geprüft werden Ladepunkte und Zähler. Fehlende Unit-ID zählt als eigener Wert.
 */
export const dupIpRule: Rule = {
  id: 'DUP_IP',
  severity: 'error',
  check({ project }) {
    const entries: { endpoint: NetworkEndpoint; name: string; targetId: string }[] = [
      ...project.chargePoints.map((cp) => ({
        endpoint: cp.network,
        name: cp.label,
        targetId: cp.id,
      })),
    ];
    if (project.site.gridMeter) {
      entries.push({
        endpoint: project.site.gridMeter.network,
        name: 'Netzzähler',
        targetId: SITE_LEVEL_ID,
      });
    }
    if (project.site.pv?.meter) {
      entries.push({
        endpoint: project.site.pv.meter.network,
        name: 'PV-Zähler',
        targetId: SITE_LEVEL_ID,
      });
    }

    const byKey = new Map<string, typeof entries>();
    for (const entry of entries) {
      const { ip, port, unitId } = entry.endpoint;
      const key = `${ip}|${port}|${unitId ?? '-'}`;
      byKey.set(key, [...(byKey.get(key) ?? []), entry]);
    }

    return [...byKey.values()]
      .filter((list) => list.length > 1)
      .map((list) => {
        const { ip, port, unitId } = (list[0] as (typeof entries)[number]).endpoint;
        const address = `${ip}:${port}${unitId === undefined ? '' : ` (Unit-ID ${unitId})`}`;
        return finding(
          dupIpRule,
          `Adresse ${address} mehrfach vergeben: ${list.map((e) => e.name).join(', ')}`,
          [...new Set(list.map((e) => e.targetId))],
        );
      });
  },
};
