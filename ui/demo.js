/* [codex] ureten: codex */
import { createProject, addRoom, addElement, addZone, templatePoints } from '../geometry/core.js';
import { uid } from './base.js';
export function sampleProject(kind = 'konut') {
  const shop = kind === 'dukkan',
    p = createProject(shop ? 'Asma Katlı Atölye' : 'Avlu Evi');
  p.sample = true;
  p.location = 'Örnek proje';
  const floorId = p.floors[0].id;
  const room = (name, code, coords, height = 2950) =>
    addRoom(p, { floorId, name, code, height, points: coords.map(([x, y]) => ({ x, y })) });
  const opening = (r, i, type, name, offset, width, height, sill) =>
    addElement(p, {
      roomId: r.id,
      wallId: r.wallIds[i],
      type,
      name,
      offset,
      width,
      height,
      sill,
      depth: 120,
      side: 'inside',
      ...(type === 'door' ? { swing: 'left-in' } : {}),
    });
  if (shop) {
    const r = addRoom(p, {
      floorId,
      name: 'Atölye',
      code: 'Z-01',
      height: 5400,
      points: templatePoints('rect', 8000, 6200),
    });
    addZone(p, {
      roomId: r.id,
      name: 'Asma kat',
      type: 'platform',
      points: templatePoints('rect', 8000, 2500, { x: 0, y: 3700 }),
      bottom: 2630,
      top: 2850,
    });
    opening(r, 0, 'window', 'Vitrin', 1000, 4600, 3400, 100);
    opening(r, 0, 'door', 'Giriş kapısı', 5950, 1100, 2350, 0);
  } else {
    const living = room('Salon', 'Z-01', [
      [0, 0],
      [5400, 0],
      [5400, 3900],
      [3100, 3900],
      [0, 3900],
    ]);
    const kitchen = room('Mutfak', 'Z-02', [
      [5400, 0],
      [9000, 0],
      [9000, 3900],
      [5400, 3900],
    ]);
    const bed = room('Yatak odası', 'Z-03', [
      [0, 3900],
      [3100, 3900],
      [3100, 7000],
      [0, 7000],
    ]);
    const entry = room('Antre', 'Z-04', [
      [3100, 3900],
      [5400, 3900],
      [5400, 7000],
      [3100, 7000],
    ]);
    const bath = room(
      'Banyo',
      'Z-05',
      [
        [5400, 3900],
        [9000, 3900],
        [9000, 7000],
        [5400, 7000],
      ],
      2650,
    );
    opening(living, 0, 'window', 'Bahçe penceresi', 1100, 2450, 1450, 850);
    opening(living, 4, 'window', 'Yan pencere', 950, 1650, 1450, 850);
    opening(living, 2, 'door', 'Salon kapısı', 650, 900, 2100, 0);
    opening(kitchen, 0, 'window', 'Mutfak penceresi', 900, 1550, 1250, 1050);
    opening(kitchen, 3, 'door', 'Mutfak kapısı', 2150, 850, 2100, 0);
    opening(bed, 2, 'window', 'Oda penceresi', 900, 1450, 1400, 850);
    opening(bed, 1, 'door', 'Oda kapısı', 900, 800, 2100, 0);
    opening(entry, 2, 'door', 'Giriş', 650, 1000, 2200, 0);
    opening(bath, 3, 'door', 'Banyo kapısı', 1200, 800, 2100, 0);
    opening(bath, 1, 'window', 'Vasistas', 950, 750, 650, 1550);
    p.furniture = [
      { id: uid(), roomId: living.id, type: 'sofa', x: 520, y: 400, width: 2300, depth: 800 },
      { id: uid(), roomId: living.id, type: 'rug', x: 870, y: 1440, width: 1260, depth: 530 },
      { id: uid(), roomId: kitchen.id, type: 'counter', x: 5650, y: 220, width: 3060, depth: 610 },
      { id: uid(), roomId: kitchen.id, type: 'table', x: 6810, y: 2540, width: 1480, depth: 680 },
      { id: uid(), roomId: bed.id, type: 'bed', x: 220, y: 4400, width: 1300, depth: 1850 },
      { id: uid(), roomId: bath.id, type: 'bath', x: 7080, y: 5920, width: 1620, depth: 760 },
    ];
  }
  for (const w of p.walls)
    w.thickness = p.rooms.filter((r) => r.wallIds.includes(w.id)).length > 1 ? 120 : 200;
  p.visits.push({
    id: uid(),
    name: 'İlk saha ziyareti',
    date: p.createdAt,
    person: '',
    instrument: 'Şerit metre',
    status: 'open',
  });
  return p;
}
